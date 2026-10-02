import { z } from 'zod';

export const PROJECT_SETTINGS_TABS = [
  'general',
  'members',
  'repositories',
  'devops',
  'activity'
] as const;
export type ProjectSettingsTab = (typeof PROJECT_SETTINGS_TABS)[number];

export const TERMINAL_ACCESS_VALUES = ['DISABLED', 'OWNERS', 'MEMBERS'] as const;

export const generalSchema = z.object({
  name: z.string().trim().min(2, 'nameTooShort').max(80),
  description: z.string().trim().max(500),
  issuePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'prefixInvalid')
});

export const devopsSettingsSchema = z.object({
  terminalAccess: z.enum(TERMINAL_ACCESS_VALUES),
  sshAllowedHosts: z.array(z.string().trim().min(1).max(253)).max(100),
  hiddenPipelineBranches: z.array(z.string().trim().min(1).max(255)).max(100)
});

export type DevopsSettings = z.infer<typeof devopsSettingsSchema>;
