import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  Box,
} from '@mui/material';
import { CheckCircleOutline, ErrorOutline, InfoOutlined, WarningAmber } from '@mui/icons-material';
import {
  type AlertOptions,
  type ConfirmOptions,
  type PromptOptions,
  setAppDialogHandlers,
} from '../utils/appDialog';

type DialogKind = 'alert' | 'confirm' | 'prompt';

type DialogState = {
  open: boolean;
  kind: DialogKind;
  message: string;
  alertOptions?: AlertOptions;
  confirmOptions?: ConfirmOptions;
  promptOptions?: PromptOptions;
  promptValue: string;
};

const initialState: DialogState = {
  open: false,
  kind: 'alert',
  message: '',
  promptValue: '',
};

type AppDialogContextValue = {
  alert: (message: string, options?: AlertOptions) => Promise<void>;
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  prompt: (message: string, options?: PromptOptions) => Promise<string | null>;
};

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

const SEVERITY_ICONS = {
  info: InfoOutlined,
  success: CheckCircleOutline,
  warning: WarningAmber,
  error: ErrorOutline,
} as const;

const SEVERITY_COLORS = {
  info: 'info.main',
  success: 'success.main',
  warning: 'warning.main',
  error: 'error.main',
} as const;

function defaultTitle(kind: DialogKind, options?: AlertOptions | ConfirmOptions | PromptOptions) {
  if (options?.title) return options.title;
  if (kind === 'confirm') return 'Confirm';
  if (kind === 'prompt') return 'Input required';
  const severity = (options as AlertOptions | undefined)?.severity;
  if (severity === 'error') return 'Error';
  if (severity === 'warning') return 'Warning';
  if (severity === 'success') return 'Success';
  return 'Notice';
}

export const AppDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<DialogState>(initialState);
  const resolverRef = useRef<((value: unknown) => void) | null>(null);

  const closeDialog = useCallback((value: unknown) => {
    setState(initialState);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(value);
  }, []);

  const alert = useCallback((message: string, options?: AlertOptions) => {
    return new Promise<void>((resolve) => {
      resolverRef.current = () => resolve();
      setState({
        open: true,
        kind: 'alert',
        message,
        alertOptions: options,
        promptValue: '',
      });
    });
  }, []);

  const confirm = useCallback((message: string, options?: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = (value) => resolve(Boolean(value));
      setState({
        open: true,
        kind: 'confirm',
        message,
        confirmOptions: options,
        promptValue: '',
      });
    });
  }, []);

  const prompt = useCallback((message: string, options?: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolverRef.current = (value) => resolve(value as string | null);
      setState({
        open: true,
        kind: 'prompt',
        message,
        promptOptions: options,
        promptValue: options?.defaultValue ?? '',
      });
    });
  }, []);

  const value = useMemo(() => ({ alert, confirm, prompt }), [alert, confirm, prompt]);

  useEffect(() => {
    setAppDialogHandlers({ alert, confirm, prompt });
    return () => setAppDialogHandlers(null);
  }, [alert, confirm, prompt]);

  const handleConfirm = () => {
    if (state.kind === 'alert') {
      closeDialog(undefined);
      return;
    }
    if (state.kind === 'confirm') {
      closeDialog(true);
      return;
    }
    const trimmed = state.promptValue.trim();
    if (state.promptOptions?.required && !trimmed) return;
    closeDialog(trimmed || state.promptValue);
  };

  const handleCancel = () => {
    if (state.kind === 'confirm') closeDialog(false);
    else if (state.kind === 'prompt') closeDialog(null);
    else closeDialog(undefined);
  };

  const title = defaultTitle(state.kind, state.alertOptions ?? state.confirmOptions ?? state.promptOptions);
  const confirmLabel =
    state.kind === 'alert'
      ? state.alertOptions?.confirmLabel ?? 'OK'
      : state.kind === 'confirm'
        ? state.confirmOptions?.confirmLabel ?? 'Confirm'
        : state.promptOptions?.confirmLabel ?? 'OK';
  const cancelLabel =
    state.kind === 'confirm'
      ? state.confirmOptions?.cancelLabel ?? 'Cancel'
      : state.promptOptions?.cancelLabel ?? 'Cancel';
  const destructive = state.kind === 'confirm' && state.confirmOptions?.destructive;
  const alertSeverity = state.kind === 'alert' ? state.alertOptions?.severity ?? 'info' : null;
  const SeverityIcon = alertSeverity ? SEVERITY_ICONS[alertSeverity] : null;

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      <Dialog
        open={state.open}
        onClose={(_, reason) => {
          if (reason === 'backdropClick' && state.kind !== 'alert') return;
          handleCancel();
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {SeverityIcon && alertSeverity ? (
            <Box display="flex" alignItems="center" gap={1}>
              <SeverityIcon sx={{ color: SEVERITY_COLORS[alertSeverity] }} />
              {title}
            </Box>
          ) : (
            title
          )}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{state.message}</Typography>
          {state.kind === 'prompt' && (
            <TextField
              autoFocus
              fullWidth
              margin="normal"
              value={state.promptValue}
              onChange={(e) => setState((prev) => ({ ...prev, promptValue: e.target.value }))}
              placeholder={state.promptOptions?.placeholder}
              multiline={state.promptOptions?.multiline}
              minRows={state.promptOptions?.multiline ? 3 : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !state.promptOptions?.multiline) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {state.kind !== 'alert' && (
            <Button onClick={handleCancel} color="inherit">
              {cancelLabel}
            </Button>
          )}
          <Button
            onClick={handleConfirm}
            variant="contained"
            color={destructive ? 'error' : 'primary'}
            disabled={
              state.kind === 'prompt' &&
              !!state.promptOptions?.required &&
              !state.promptValue.trim()
            }
          >
            {confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </AppDialogContext.Provider>
  );
};

export function useAppDialog(): AppDialogContextValue {
  const ctx = useContext(AppDialogContext);
  if (!ctx) {
    throw new Error('useAppDialog must be used within AppDialogProvider');
  }
  return ctx;
}
