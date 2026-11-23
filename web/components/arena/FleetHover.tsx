'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { cn } from '@/lib/utils';

/** Which agent the pointer (or keyboard focus) is on, and whether it came from a card or the graph. */
type FleetHoverState = { agentId: string; source: 'card' | 'graph' } | null;

type FleetHoverValue = {
  hovered: FleetHoverState;
  setHovered: Dispatch<SetStateAction<FleetHoverState>>;
};

const FleetHoverContext = createContext<FleetHoverValue>({
  hovered: null,
  setHovered: () => undefined,
});

/** The fleet's cards and its swarm graph read and write the same hover, so each lights up the other. */
const useFleetHover = () => useContext(FleetHoverContext);

type FleetHoverProviderProps = {
  children: ReactNode;
};

const FleetHoverProvider = ({ children }: FleetHoverProviderProps) => {
  const [hovered, setHovered] = useState<FleetHoverState>(null);
  const value = useMemo(() => ({ hovered, setHovered }), [hovered]);
  return <FleetHoverContext.Provider value={value}>{children}</FleetHoverContext.Provider>;
};

type FleetHoverItemProps = {
  agentId: string;
  className?: string;
  children: ReactNode;
};

/** A seat card's list item: hovering or focusing it highlights the agent's node in the graph. */
const FleetHoverItem = ({ agentId, className, children }: FleetHoverItemProps) => {
  const { hovered, setHovered } = useFleetHover();
  const on = hovered?.agentId === agentId;
  const enter = () => setHovered({ agentId, source: 'card' });
  const leave = () => setHovered((h) => (h?.source === 'card' && h.agentId === agentId ? null : h));
  return (
    <li
      data-slot="fleet-hover-item"
      data-highlighted={on || undefined}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onFocus={enter}
      onBlur={leave}
      className={cn(
        className,
        on && 'border-fg-2 bg-panel-raised',
        on && hovered?.source === 'graph' && 'ring-1 ring-fg-3',
      )}
    >
      {children}
    </li>
  );
};

export { FleetHoverItem, FleetHoverProvider, useFleetHover };
