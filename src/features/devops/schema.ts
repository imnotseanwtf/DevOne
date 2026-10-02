import { z } from 'zod';

const size = {
  cols: z.number().int().min(10).max(500),
  rows: z.number().int().min(5).max(200)
};

// A hostname, IPv4 or IPv6 address; brackets around IPv6 are accepted and dropped.
const hostSchema = z
  .string()
  .trim()
  .min(1, 'Enter a host')
  .max(253)
  .transform((value) => value.replace(/^\[(.*)\]$/, '$1'))
  .refine((value) => /^[A-Za-z0-9._:-]+$/.test(value), 'Enter a hostname or IP address');

export const sshAuthMethods = ['password', 'privateKey'] as const;

export const newSshConnectionSchema = z
  .object({
    host: hostSchema,
    port: z
      .number({ error: 'Enter a port' })
      .int()
      .min(1, 'Enter a port')
      .max(65535, 'Enter a port'),
    username: z.string().trim().min(1, 'Enter a username').max(128),
    authMethod: z.enum(sshAuthMethods),
    password: z.string().max(1024),
    privateKey: z.string().max(32_768),
    passphrase: z.string().max(1024),
    save: z.boolean(),
    name: z.string().trim().max(80)
  })
  .superRefine((value, context) => {
    if (value.authMethod === 'password' && !value.password) {
      context.addIssue({ code: 'custom', path: ['password'], message: 'Enter the password' });
    }
    if (value.authMethod === 'privateKey' && !value.privateKey.includes('PRIVATE KEY')) {
      context.addIssue({
        code: 'custom',
        path: ['privateKey'],
        message: 'Paste a private key (-----BEGIN … PRIVATE KEY-----)'
      });
    }
  });

export type NewSshConnection = z.infer<typeof newSshConnectionSchema>;

export const connectRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('saved'),
    projectId: z.string().min(1),
    hostId: z.string().min(1),
    ...size
  }),
  z.object({
    mode: z.literal('new'),
    projectId: z.string().min(1),
    connection: newSshConnectionSchema,
    ...size
  })
]);

export const sessionMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('input'),
    data: z
      .string()
      .min(1)
      .max(64 * 1024)
  }),
  z.object({ type: z.literal('resize'), ...size })
]);
