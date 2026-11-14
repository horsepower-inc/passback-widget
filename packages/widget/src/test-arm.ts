import { CLASS } from './styles';

export function armWidget(root: ShadowRoot): void {
  root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!.click();
}
