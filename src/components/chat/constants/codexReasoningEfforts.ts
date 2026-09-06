import { Atom, Brain, Circle, CircleOff, Crown, Gauge, Rocket, Sparkles, Zap } from 'lucide-react';

export const codexReasoningEfforts = [
  {
    id: 'default',
    name: 'Default',
    description: 'Use the model default reasoning effort',
    icon: Circle,
    color: 'text-gray-600',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Fastest response with minimal deliberate reasoning',
    icon: Gauge,
    color: 'text-slate-600',
  },
  {
    id: 'none',
    name: 'None',
    description: 'No additional reasoning effort',
    icon: CircleOff,
    color: 'text-slate-600',
  },
  {
    id: 'low',
    name: 'Low',
    description: 'Light reasoning with lower latency',
    icon: Brain,
    color: 'text-blue-600',
  },
  {
    id: 'medium',
    name: 'Medium',
    description: 'Balanced depth and latency',
    icon: Zap,
    color: 'text-violet-600',
  },
  {
    id: 'high',
    name: 'High',
    description: 'More deliberate reasoning for harder tasks',
    icon: Sparkles,
    color: 'text-indigo-600',
  },
  {
    id: 'xhigh',
    name: 'Extra High',
    description: 'Very high reasoning effort for complex tasks',
    icon: Atom,
    color: 'text-orange-600',
  },
  {
    id: 'max',
    name: 'Max',
    description: 'Maximum reasoning effort',
    icon: Crown,
    color: 'text-red-600',
  },
  {
    id: 'ultra',
    name: 'Ultra',
    description: 'The highest reasoning effort the model offers',
    icon: Rocket,
    color: 'text-rose-700',
  },
] as const;

export type CodexReasoningEffortId = (typeof codexReasoningEfforts)[number]['id'];
