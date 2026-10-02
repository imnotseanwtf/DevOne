'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface OpenInVsCodeMenuProps {
  provider: 'GITHUB' | 'GITLAB';
  fullName: string;
  webUrl: string;
  branch: string;
}

/** Branch names keep their slashes in these URLs; only each segment is escaped. */
function encodeBranch(branch: string) {
  return branch.split('/').map(encodeURIComponent).join('/');
}

export function vsCodeLinks({ provider, fullName, webUrl, branch }: OpenInVsCodeMenuProps) {
  const desktop = `vscode://vscode.git/clone?url=${encodeURIComponent(`${webUrl}.git`)}`;
  if (provider === 'GITHUB') {
    return {
      web: `https://vscode.dev/github/${fullName}/tree/${encodeBranch(branch)}`,
      webLabel: 'VS Code for the Web',
      desktop
    };
  }
  // GitLab's Web IDE is VS Code-based and lives on the instance itself.
  const origin = new URL(webUrl).origin;
  return {
    web: `${origin}/-/ide/project/${fullName}/edit/${encodeBranch(branch)}/-/`,
    webLabel: 'GitLab Web IDE (VS Code)',
    desktop
  };
}

export function OpenInVsCodeMenu(props: OpenInVsCodeMenuProps) {
  const links = vsCodeLinks(props);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant='outline' size='sm' />}>
        <Icons.code aria-hidden='true' />
        Open in VS Code
        <Icons.chevronDown aria-hidden='true' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-64'>
        <DropdownMenuItem
          render={
            <a
              href={links.web}
              target='_blank'
              rel='noreferrer noopener'
              aria-label={`Open ${props.branch} in ${links.webLabel}`}
            />
          }
        >
          <Icons.externalLink aria-hidden='true' />
          <span className='flex flex-col'>
            {links.webLabel}
            <span className='text-muted-foreground text-xs'>
              Opens {props.branch} in the browser
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={links.desktop} aria-label='Clone in VS Code desktop' />}>
          <Icons.laptop aria-hidden='true' />
          <span className='flex flex-col'>
            VS Code desktop
            <span className='text-muted-foreground text-xs'>Clones the repository locally</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
