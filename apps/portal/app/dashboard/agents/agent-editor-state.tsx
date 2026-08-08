'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type AgentEditorStateValue = {
  isDirty: boolean;
  isPending: boolean;
  setDirty: (_dirty: boolean) => void;
  setPending: (_pending: boolean) => void;
};

const AgentEditorStateContext = createContext<AgentEditorStateValue | null>(
  null,
);

export function AgentEditorProvider({ children }: { children: ReactNode }) {
  const [isDirty, setDirty] = useState(false);
  const [isPending, setPending] = useState(false);

  const value = useMemo(
    () => ({
      isDirty,
      isPending,
      setDirty,
      setPending,
    }),
    [isDirty, isPending],
  );

  return (
    <AgentEditorStateContext.Provider value={value}>
      {children}
    </AgentEditorStateContext.Provider>
  );
}

export function useAgentEditorState(): AgentEditorStateValue | null {
  return useContext(AgentEditorStateContext);
}
