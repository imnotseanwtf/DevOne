'use client';

import { Button } from '@/components/ui/button';
import {
  BranchPicker,
  type BranchPickerRepository
} from '@/features/git/components/workbench/branch-picker';
import type { GitBranch } from '@/lib/git/provider';
import { useRouter } from 'next/navigation';
import { parseAsString, useQueryState } from 'nuqs';
import { createContext, useContext, useEffect, useRef, type RefObject } from 'react';

/** What the workbench lets the page header do, so switches still ask about uncommitted changes. */
export interface BranchControl {
  switchTo: (name: string) => void;
  create: () => void;
  /** Runs `leave` now, or after confirming when there are uncommitted changes. */
  confirmLeave: (leave: () => void) => void;
}

const BranchControlContext = createContext<RefObject<BranchControl | null> | null>(null);

export function BranchControlProvider({ children }: { children: React.ReactNode }) {
  const control = useRef<BranchControl | null>(null);
  return <BranchControlContext value={control}>{children}</BranchControlContext>;
}

/** Called by the workbench on every render so the header always reaches its latest handlers. */
export function useRegisterBranchControl(control: BranchControl) {
  const slot = useContext(BranchControlContext);
  useEffect(() => {
    if (!slot) return;
    slot.current = control;
    return () => {
      slot.current = null;
    };
  });
}

export function HeaderBranchPicker({
  projectId,
  branches,
  defaultBranch,
  repositories,
  activeRepositoryId
}: {
  projectId: string;
  branches: GitBranch[];
  defaultBranch: string;
  repositories: BranchPickerRepository[];
  activeRepositoryId: string;
}) {
  const router = useRouter();
  const slot = useContext(BranchControlContext);
  const [branch, setBranch] = useQueryState(
    'ref',
    parseAsString.withDefault(defaultBranch).withOptions({ shallow: false })
  );

  return (
    <BranchPicker
      branches={branches}
      current={branch}
      onSelect={(name) => (slot?.current ? slot.current.switchTo(name) : void setBranch(name))}
      onCreate={slot ? () => slot.current?.create() : undefined}
      repositories={repositories}
      activeRepositoryId={activeRepositoryId}
      onSelectRepository={(id) => {
        if (id === activeRepositoryId) return;
        const leave = () => router.push(`/projects/${projectId}/git?repo=${id}`);
        if (slot?.current) slot.current.confirmLeave(leave);
        else leave();
      }}
      align='end'
      trigger={<Button variant='outline' size='sm' className='max-w-64 font-mono text-xs' />}
    />
  );
}
