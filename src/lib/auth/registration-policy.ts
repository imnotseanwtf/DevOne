export type RegistrationDecision =
  | 'existing'
  | 'admin'
  | 'member'
  | 'bootstrap-disabled'
  | 'registration-disabled';

export function decideRegistration(
  existingUser: boolean,
  userCount: number,
  allowBootstrap: boolean,
  allowRegistration: boolean
): RegistrationDecision {
  if (existingUser) return 'existing';
  if (userCount === 0) return allowBootstrap ? 'admin' : 'bootstrap-disabled';
  return allowRegistration ? 'member' : 'registration-disabled';
}
