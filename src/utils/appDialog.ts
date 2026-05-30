export type AlertSeverity = 'info' | 'success' | 'warning' | 'error';

export type AlertOptions = {
  title?: string;
  severity?: AlertSeverity;
  confirmLabel?: string;
};

export type ConfirmOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type PromptOptions = {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type AppDialogHandlers = {
  alert: (message: string, options?: AlertOptions) => Promise<void>;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (message: string, options?: PromptOptions) => Promise<string | null>;
};

let handlers: AppDialogHandlers | null = null;

export function setAppDialogHandlers(next: AppDialogHandlers | null) {
  handlers = next;
}

export async function appAlert(message: string, options?: AlertOptions): Promise<void> {
  if (handlers) {
    await handlers.alert(message, options);
    return;
  }
  window.alert(message);
}

export async function appConfirm(message: string, options?: ConfirmOptions): Promise<boolean> {
  if (handlers) {
    return handlers.confirm(message, options);
  }
  return window.confirm(message);
}

export async function appPrompt(message: string, options?: PromptOptions): Promise<string | null> {
  if (handlers) {
    return handlers.prompt(message, options);
  }
  return window.prompt(message, options?.defaultValue ?? '');
}
