// wires injectSource (a) into a Vite dev-server plugin.

import { isAbsolute, join, relative, sep } from 'node:path';
import type {
  HtmlTagDescriptor,
  IndexHtmlTransformContext,
  Plugin,
  ResolvedConfig,
  ViteDevServer,
} from 'vite';
import { attachChannel } from './channel';
import { ShotInboxAdapter } from './shot-inbox';
import { createShotStash, serveShotRoutes, shotAttrs, warnAgentBuildShots } from './shot-local';
import { formatLoc, injectSource } from './inject';
import { buildIdTag } from './build-id-tag';
import { hotBridgeSrc, hotBridgeTag, loadHotBridge, resolveHotBridge } from './hot-bridge';
import { buildFormat, gitBuildId, writeManifestOnClose } from './manifest';
import { keepHeadInSsr, loadHead, resolveHead } from './head-module';
import { isActive, isTestRun, outsideStagingMessage } from './active';
import { pullRequestFromEnv, pullRequestScript } from './deploy-env';
import { checkMode, hostedEndpoint, resolveMode, type HostedOptions } from './hosted';
import { widgetSettingAttrs, type WidgetSettings } from './widget-settings';
import { resolveRootOption } from './project-root';
import {
  emitWidgetAsset,
  headTokens,
  replaceAssetTokens,
  type WidgetAssetFiles,
} from './head-build';
import {
  buildWidgetSrc,
  createWidgetMiddleware,
  readWidgetArtifact,
  serveWidgetSrc,
  widgetTag,
} from './widget-bundle';
import {
  createChunkMiddleware,
  readChunkArtifact,
  serveChunkSrc,
  withChunkSrc,
} from './widget-chunk';
import { emitShotAsset, shotBuilt, withShotSrc } from './widget-shot';

function buildIdTags(root: string, buildIdOption: string | undefined): HtmlTagDescriptor[] {
  const id = buildIdOption ?? gitBuildId(root);
  return id === undefined ? [] : [buildIdTag(id)];
}

function transformModule(
  state: { root: string; command: 'build' | 'serve'; sourceIds: Map<string, string> },
  code: string,
  id: string,
  warn: (message: string) => void,
): ReturnType<typeof injectSource> {
  const { root, command, sourceIds } = state;
  const file = id.split('?')[0]!;
  if (!/\.(jsx|tsx)$/.test(file)) return null;
  if (file.includes('/node_modules/')) return null;
  const relPath = relative(root, file);
  if (relPath.startsWith('..') || isAbsolute(relPath)) return null;
  const format = command === 'build' ? buildFormat(sourceIds, warn) : formatLoc;
  const result = injectSource(code, relPath.split(sep).join('/'), format);
  if (!result) return null;

  // injectSource names the map source by relPath, but Vite resolves a relative
  // source against the module's own directory, so "src/App.tsx" would map to
  // "src/src/App.tsx". The absolute path lets Vite relativise it correctly and
  // fill sourcesContent from disk.
  result.map.sources = [file];
  return result;
}

function setUpWidgetServing(
  server: ViteDevServer,
  root: string,
  base: string,
  localShots: boolean,
): void {
  const stash = localShots ? createShotStash() : undefined;
  const adapter = stash && new ShotInboxAdapter(join(root, '.passback', 'inbox'), stash);
  attachChannel(server, { root, adapter });
  if (stash) serveShotRoutes(server.middlewares, base, stash);
  const { bytes } = readWidgetArtifact('local');
  server.middlewares.use(createWidgetMiddleware(base, bytes));
  server.middlewares.use(createChunkMiddleware(base, readChunkArtifact().bytes));
}

function withEndpoint(tag: HtmlTagDescriptor, endpoint: string | undefined): HtmlTagDescriptor {
  if (endpoint === undefined) return tag;
  const attrs = typeof tag.attrs === 'object' ? tag.attrs : {};
  return { ...tag, attrs: { ...attrs, 'data-passback-endpoint': endpoint } };
}

function withSettingAttrs(
  tag: HtmlTagDescriptor,
  attrs: Record<string, string>,
): HtmlTagDescriptor {
  const own = typeof tag.attrs === 'object' ? tag.attrs : {};
  return { ...tag, attrs: { ...own, ...attrs } };
}

function builtWidgetTag(
  base: string,
  assetFiles: WidgetAssetFiles,
  ctx: IndexHtmlTransformContext,
): HtmlTagDescriptor {
  const { widgetFile, chunkFile, shotFile } = assetFiles;
  const shotSrc = shotFile && buildWidgetSrc(base, ctx.path, shotFile);
  return withShotSrc(
    withChunkSrc(
      widgetTag(buildWidgetSrc(base, ctx.path, widgetFile)),
      buildWidgetSrc(base, ctx.path, chunkFile),
    ),
    shotSrc,
  );
}

function widgetIndexHtmlTags(
  state: {
    root: string;
    base: string;
    command: 'build' | 'serve';
    buildId: string | undefined;
    endpoint: string | undefined;
    pullRequest: number | undefined;
    settingAttrs: Record<string, string>;
  },
  assetFiles: WidgetAssetFiles | null,
  ctx: IndexHtmlTransformContext,
): HtmlTagDescriptor[] {
  const tags = buildIdTags(state.root, state.buildId);
  if (state.command === 'serve') {
    if (state.endpoint === undefined) tags.push(hotBridgeTag(hotBridgeSrc(state.base)));
    const widget = withChunkSrc(widgetTag(serveWidgetSrc(state.base)), serveChunkSrc(state.base));
    tags.push(withSettingAttrs(withEndpoint(widget, state.endpoint), state.settingAttrs));
    return tags;
  }
  if (state.pullRequest !== undefined) {
    const children = pullRequestScript(state.pullRequest);
    tags.push({ tag: 'script', children, injectTo: 'head-prepend' });
  }
  if (assetFiles) {
    const widget = withEndpoint(builtWidgetTag(state.base, assetFiles, ctx), state.endpoint);
    tags.push(withSettingAttrs(widget, state.settingAttrs));
  }
  return tags;
}

type PluginState = {
  root: string;
  base: string;
  command: 'build' | 'serve';
  sourceIds: Map<string, string>;
  outputSucceeded: boolean;
  assetFiles: WidgetAssetFiles | null;
  endpoint: string | undefined;
  pullRequest: number | undefined;
  agentShots: boolean;
};

function createPluginState(): PluginState {
  return {
    root: '',
    base: '/',
    command: 'serve',
    sourceIds: new Map<string, string>(),
    outputSucceeded: false,
    assetFiles: null,
    endpoint: undefined,
    pullRequest: undefined,
    agentShots: false,
  };
}

export type PassbackOptions = {
  buildId?: string;
  stagingModes?: string[];
  root?: string;
  /** Lets the widget draw on a screenshot. Defaults to on in relay mode; in agent mode it is available on the dev server only. */
  screenshots?: boolean;
  /** Runs the plugin under Vitest. */
  enableInTests?: boolean;
} & HostedOptions &
  WidgetSettings;

function shouldApply(options: PassbackOptions, env: Parameters<typeof isActive>[0]): boolean {
  const mode = resolveMode(options, env.command);
  if (mode === 'off') return false;
  if (isTestRun(env, process.env) && options.enableInTests !== true) return false;
  const active = isActive(env, options.stagingModes ?? []);
  if (!active && mode === 'relay') console.warn(outsideStagingMessage(env.mode));
  return active;
}

function resolveState(state: PluginState, config: ResolvedConfig, options: PassbackOptions): void {
  state.root = resolveRootOption(config.root, options.root);
  state.command = config.command;
  state.base = config.base ?? '/';
  state.endpoint =
    resolveMode(options, config.command) === 'relay' ? hostedEndpoint(options) : undefined;
  state.agentShots = options.screenshots === true && state.endpoint === undefined;
  state.pullRequest = state.endpoint === undefined ? undefined : pullRequestFromEnv(process.env);
}

type IndexTags = (
  ctx: IndexHtmlTransformContext,
  head?: ReturnType<typeof headTokens>,
) => HtmlTagDescriptor[];

// Serve tags never read the context, so the head module passes a bare one.
function indexTagsFor(state: PluginState, options: PassbackOptions, attrs: Record<string, string>) {
  return ((ctx, head) => {
    const settingAttrs = shotAttrs(state, options.screenshots, attrs);
    const tagState = { ...state, base: head?.base ?? state.base, buildId: options.buildId };
    return widgetIndexHtmlTags({ ...tagState, settingAttrs }, head?.files ?? state.assetFiles, ctx);
  }) as IndexTags;
}

function headHooks(state: PluginState, options: PassbackOptions, indexTags: IndexTags) {
  return {
    resolveId(id: string) {
      if (state.command === 'serve') return resolveHead(id) ?? resolveHotBridge(id);
      return state.endpoint === undefined ? undefined : resolveHead(id);
    },
    load(id: string) {
      if (state.command === 'serve') return loadHead(id, indexTags) ?? loadHotBridge(id);
      if (state.endpoint === undefined) return undefined;
      const head = headTokens(state.base, shotBuilt(state, options.screenshots));
      return loadHead(id, (ctx) => indexTags(ctx, head));
    },
  };
}

export function passback(options: PassbackOptions = {}): Plugin {
  const settingAttrs = widgetSettingAttrs(options);
  checkMode(options.mode);
  const state = createPluginState();
  const indexTags = indexTagsFor(state, options, settingAttrs);
  return {
    name: 'passback',
    enforce: 'pre',
    apply: (_config, env) => shouldApply(options, env),
    config: (config, env) => (env.command === 'serve' ? keepHeadInSsr(config) : undefined),
    configResolved(config) {
      resolveState(state, config, options);
    },
    buildStart() {
      warnAgentBuildShots(state, (message) => this.warn(message));
      state.outputSucceeded = false;
      state.assetFiles = null;
    },
    ...headHooks(state, options, indexTags),
    configureServer(server) {
      setUpWidgetServing(server, state.root, state.base, state.agentShots);
    },
    transform(code, id) {
      return transformModule(state, code, id, (message) => this.warn(message));
    },
    generateBundle(_options, bundle) {
      const shotFile = emitShotAsset(this, shotBuilt(state, options.screenshots));
      state.assetFiles = { ...emitWidgetAsset(this), shotFile };
      replaceAssetTokens(bundle, state.assetFiles);
    },
    writeBundle() {
      state.outputSucceeded = true;
    },
    closeBundle(error) {
      if (error || !state.outputSucceeded) return;
      writeManifestOnClose(state, options.buildId, (message) => this.warn(message));
    },
    transformIndexHtml(_html, ctx: IndexHtmlTransformContext): HtmlTagDescriptor[] {
      return indexTags(ctx);
    },
    api: {
      sourceIds: (): ReadonlyMap<string, string> => state.sourceIds,
      root: (): string => state.root,
    },
  };
}
