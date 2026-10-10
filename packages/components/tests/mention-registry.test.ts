import { describe, expect, it, vi } from 'vitest';

import {
  buildCommandCandidates,
  buildFileCandidates,
  buildMentionFileIndex,
  getCategoryNavigateText,
  selectMentionMenuView,
  selectMentionMenuViewForTrigger,
  toFileCandidate,
  type MentionCandidate,
  type MentionCategory,
} from '../src/components/mentions/mention-registry';

function makeCandidate(value: string): MentionCandidate {
  return {
    value,
    label: value,
    insertText: `@${value}`,
    kind: 'file',
    icon: 'file',
    title: value,
  };
}

function makeCategory(
  id: MentionCategory['id'],
  namespace: string,
  label: string,
  candidates: string[]
): MentionCategory & { getCandidates: ReturnType<typeof vi.fn> } {
  const getCandidates = vi.fn((term: string) =>
    candidates.filter((entry) => entry.includes(term)).map(makeCandidate)
  );
  return {
    id,
    namespace,
    label,
    icon: 'file',
    status: 'ready',
    getCandidates,
  };
}

describe('selectMentionMenuView', () => {
  it('shows the category list when nothing is typed after the trigger', () => {
    const file = makeCategory('file', 'file', 'Files', ['a.ts']);
    const issue = makeCategory('skill', 'skill', 'Skills', ['#1']);

    const view = selectMentionMenuView([file, issue], '');

    expect(view.level).toBe('categories');
    if (view.level !== 'categories') throw new Error('expected categories');
    expect(view.categories.map((entry) => entry.id)).toEqual(['file', 'skill']);
    // No ranking work is done for a menu that only lists categories.
    expect(file.getCandidates).not.toHaveBeenCalled();
    expect(issue.getCandidates).not.toHaveBeenCalled();
  });

  it('scopes to one category behind its namespace prefix', () => {
    const file = makeCategory('file', 'file', 'Files', ['a.ts']);
    const issue = makeCategory('skill', 'skill', 'Skills', ['3312', '3298']);

    const view = selectMentionMenuView([file, issue], 'skill:32');

    expect(view.level).toBe('category');
    if (view.level !== 'category') throw new Error('expected category');
    expect(view.category.id).toBe('skill');
    expect(view.term).toBe('32');
    expect(view.candidates.map((entry) => entry.value)).toEqual(['3298']);
    // Ranking the file index is the expensive one; a scoped query must not pay it.
    expect(file.getCandidates).not.toHaveBeenCalled();
  });

  it('treats an empty namespace prefix as the category with no term', () => {
    const issue = makeCategory('skill', 'skill', 'Skills', ['3312', '3298']);

    const view = selectMentionMenuView([issue], 'skill:');

    if (view.level !== 'category') throw new Error('expected category');
    expect(view.term).toBe('');
    expect(view.candidates).toHaveLength(2);
  });

  it('falls back to aggregate search for an unknown namespace', () => {
    const file = makeCategory('file', 'file', 'Files', ['nope:1']);

    const view = selectMentionMenuView([file], 'nope:1');

    expect(view.level).toBe('aggregate');
  });

  it('answers a bare term across every category and caps each group', () => {
    const file = makeCategory('file', 'file', 'Files', ['a1', 'a2', 'a3', 'a4', 'a5']);
    const issue = makeCategory('skill', 'skill', 'Skills', ['a9', 'b1']);

    const view = selectMentionMenuView([file, issue], 'a', { aggregateLimitPerCategory: 3 });

    if (view.level !== 'aggregate') throw new Error('expected aggregate');
    expect(view.term).toBe('a');
    expect(view.groups.map((group) => group.category.id)).toEqual(['file', 'skill']);
    expect(view.groups[0]?.candidates).toHaveLength(3);
    expect(view.groups[1]?.candidates.map((entry) => entry.value)).toEqual(['a9']);
  });

  it('offers categories whose own name matches the term', () => {
    const file = makeCategory('file', 'file', 'Files', []);
    const issue = makeCategory('skill', 'skill', 'Skills', []);

    const view = selectMentionMenuView([file, issue], 'ski');

    if (view.level !== 'aggregate') throw new Error('expected aggregate');
    expect(view.categories.map((entry) => entry.id)).toEqual(['skill']);
    // Nothing matched inside the categories, so there are no result groups.
    expect(view.groups).toEqual([]);
  });

  it('builds the drill-down text a category row inserts', () => {
    expect(getCategoryNavigateText({ namespace: 'skill' })).toBe('@skill:');
  });

  it('opens skills directly from the retained $ trigger', () => {
    const skill = makeCategory('skill', 'skill', 'Skills', ['review']);
    skill.directTrigger = '$';

    const view = selectMentionMenuViewForTrigger([skill], '$', 'rev');

    expect(view?.level).toBe('category');
    if (view?.level !== 'category') throw new Error('expected category');
    expect(view.category.id).toBe('skill');
    expect(view.candidates.map((entry) => entry.value)).toEqual(['review']);
  });
});

describe('candidate insertion semantics', () => {
  it('lets a directory descend but commits it without the trailing slash', () => {
    const candidate = toFileCandidate({
      kind: 'dir',
      path: 'src/components',
      token: 'src/components/',
    });

    expect(candidate.navigateText).toBe('@src/components/');
    expect(candidate.insertText).toBe('@src/components');
    expect(candidate.kind).toBe('dir');
  });

  it('commits a file with no navigation step', () => {
    const candidate = toFileCandidate({
      kind: 'file',
      path: 'src/a.ts',
      token: 'src/a.ts',
    });

    expect(candidate.navigateText).toBeUndefined();
    expect(candidate.insertText).toBe('@src/a.ts');
    expect(candidate.kind).toBe('file');
  });

  it('keeps the slash form for commands', () => {
    const [candidate] = buildCommandCandidates([{ name: 'review', description: 'Review' }], '');

    expect(candidate?.insertText).toBe('/review');
  });
});

describe('buildFileCandidates', () => {
  it('matches paths as ordered subsequences across words and punctuation', () => {
    const index = buildMentionFileIndex(
      { paths: ['src/file generated-name.ts', 'src/unrelated.ts'] },
      () => null
    );

    expect(buildFileCandidates(index, 'filename').map((entry) => entry.value)).toContain(
      'src/file generated-name.ts'
    );
  });
});
