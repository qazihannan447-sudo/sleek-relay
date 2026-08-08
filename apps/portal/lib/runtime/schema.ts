import type { AgentCapabilities, RuntimeToolName } from '../agents/capabilities';
import type { AgentValues } from '../agents/schema';
import type { BusinessConfigurationValues } from '../business-configuration/schema';
import type { BusinessKnowledgeKind } from '../knowledge/schema';

export type RuntimeKnowledgeItem = {
  content: string;
  id: string;
  kind: BusinessKnowledgeKind;
  title: string;
};

export type AgentRuntimePackage = {
  agent: {
    capabilities: AgentCapabilities;
    fallbackMessage: string;
    greeting: string;
    id: string;
    idleCheckInMessage: string;
    idleCheckInSeconds: number;
    idleEndSeconds: number;
    idleTimeoutEnabled: boolean;
    interruptionEnabled: boolean;
    language: string;
    maximumSessionDurationSeconds: number;
    name: string;
    role: string;
    silenceTimeoutSeconds: number;
    specialInstructions: string;
    status: AgentValues['status'];
    tone: string;
    voiceId: string;
  };
  business: BusinessConfigurationValues;
  capabilities: AgentCapabilities;
  enabledTools: RuntimeToolName[];
  generatedAt: string;
  groundingRules: string[];
  knowledge: RuntimeKnowledgeItem[];
  promptText: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
};

export type AgentRuntimePackageResult =
  | {
      kind: 'authenticated';
      runtimePackage: AgentRuntimePackage;
    }
  | {
      email: string | null;
      kind: 'error';
      message: string;
    }
  | {
      email: string;
      kind: 'missing-membership';
    }
  | {
      kind: 'unauthenticated';
    };
