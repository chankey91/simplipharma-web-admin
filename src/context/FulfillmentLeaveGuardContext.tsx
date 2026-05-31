import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { useAppDialog } from './AppDialogProvider';

const LEAVE_CONFIRM_MESSAGE =
  'You have fulfillment work in progress on this order. Batch assignments are saved automatically and will be restored when you return.\n\nLeave this page anyway?';

type FulfillmentLeaveGuardContextValue = {
  isGuardActive: boolean;
  setGuardActive: (active: boolean) => void;
  /** Skip the next in-app navigation confirmation (e.g. Fulfill product request). */
  allowNextNavigation: () => void;
  confirmLeaveIfNeeded: () => Promise<boolean>;
  guardedNavigate: (navigate: NavigateFunction, path: string) => void;
};

const FulfillmentLeaveGuardContext = createContext<FulfillmentLeaveGuardContextValue | null>(
  null
);

export const FulfillmentLeaveGuardProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { confirm } = useAppDialog();
  const [isGuardActive, setGuardActive] = useState(false);
  const skipNextNavigationRef = useRef(false);

  const allowNextNavigation = useCallback(() => {
    skipNextNavigationRef.current = true;
  }, []);

  const confirmLeaveIfNeeded = useCallback(async (): Promise<boolean> => {
    if (!isGuardActive) return true;
    if (skipNextNavigationRef.current) {
      skipNextNavigationRef.current = false;
      return true;
    }
    return confirm(LEAVE_CONFIRM_MESSAGE, {
      title: 'Leave order fulfillment?',
      confirmLabel: 'Leave page',
      cancelLabel: 'Stay on order',
    });
  }, [confirm, isGuardActive]);

  const guardedNavigate = useCallback(
    (navigate: NavigateFunction, path: string) => {
      // Confirmation is handled by useBlocker on OrderDetails — avoid double prompts.
      navigate(path);
    },
    []
  );

  const value = useMemo(
    () => ({
      isGuardActive,
      setGuardActive,
      allowNextNavigation,
      confirmLeaveIfNeeded,
      guardedNavigate,
    }),
    [isGuardActive, allowNextNavigation, confirmLeaveIfNeeded, guardedNavigate]
  );

  return (
    <FulfillmentLeaveGuardContext.Provider value={value}>
      {children}
    </FulfillmentLeaveGuardContext.Provider>
  );
};

export function useFulfillmentLeaveGuard(): FulfillmentLeaveGuardContextValue {
  const ctx = useContext(FulfillmentLeaveGuardContext);
  if (!ctx) {
    throw new Error('useFulfillmentLeaveGuard must be used within FulfillmentLeaveGuardProvider');
  }
  return ctx;
}
