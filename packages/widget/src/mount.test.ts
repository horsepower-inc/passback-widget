// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_ATTRIBUTE, mount } from './mount';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mount', () => {
  it('attaches an open shadow root on a host appended to body', () => {
    const { host, root } = mount(document);
    expect(document.body.contains(host)).toBe(true);
    expect(host.shadowRoot).toBe(root);
    expect(root.mode).toBe('open');
  });

  it('marks the host with data-passback-host', () => {
    const { host } = mount(document);
    expect(host.getAttribute(HOST_ATTRIBUTE)).toBe('');
  });

  it('a second mount returns the same host and root and adds no element', () => {
    const first = mount(document);
    const countBefore = document.body.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length;
    const second = mount(document);
    expect(second.host).toBe(first.host);
    expect(second.root).toBe(first.root);
    expect(document.body.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(countBefore);
  });

  it('unmount removes the host from the document', () => {
    const { host, unmount } = mount(document);
    unmount();
    expect(document.body.contains(host)).toBe(false);
  });

  it('a second unmount does nothing', () => {
    const { unmount } = mount(document);
    unmount();
    expect(() => unmount()).not.toThrow();
  });

  it('mounting after unmount creates a fresh host', () => {
    const first = mount(document);
    first.unmount();
    const second = mount(document);
    expect(second.host).not.toBe(first.host);
    expect(document.body.contains(second.host)).toBe(true);
  });

  it('appends to documentElement when the document has no body', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.body?.remove();
    const { host } = mount(doc);
    expect(doc.documentElement.contains(host)).toBe(true);
  });

  it('leaves html and body attributes untouched', () => {
    const htmlAttrsBefore = document.documentElement.getAttributeNames();
    const bodyAttrsBefore = document.body.getAttributeNames();
    mount(document);
    expect(document.documentElement.getAttributeNames()).toEqual(htmlAttrsBefore);
    expect(document.body.getAttributeNames()).toEqual(bodyAttrsBefore);
  });

  it('leaves the shadow root empty', () => {
    const { root } = mount(document);
    expect(root.childNodes.length).toBe(0);
  });
});
