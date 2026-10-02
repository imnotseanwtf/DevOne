'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { logoutAction } from '@/features/auth/actions';
import { useT } from '@/i18n/client';
import Link from 'next/link';

interface UserMenuProps {
  username: string;
  isAdmin: boolean;
}

export function UserMenu({ username, isAdmin }: UserMenuProps) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='ghost' size='sm' />}>
        <Icons.user className='lg:hidden' />
        <span className='hidden lg:inline'>@{username}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-56'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('userMenu.signedInAs', { username })}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href='/account' aria-label={t('userMenu.account')} />}>
          <Icons.user /> {t('userMenu.account')}
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem render={<Link href='/admin' aria-label={t('userMenu.admin')} />}>
            <Icons.lock /> {t('userMenu.admin')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logoutAction()}>
          <Icons.logout /> {t('userMenu.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
