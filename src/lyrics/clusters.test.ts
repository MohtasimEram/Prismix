// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { repairClusters, splitClusters } from './clusters';

describe('splitClusters', () => {
  it('keeps vowel signs on their letters', () => {
    expect(splitClusters('ভুলি')).toEqual(['ভু', 'লি']);
  });
  it('keeps a conjunct together', () => {
    expect(splitClusters('ক্ষ')).toEqual(['ক্ষ']);
  });
});

describe('repairClusters', () => {
  it('moves an orphaned vowel sign back onto its letter', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span>ক</span><span>া</span><span>র</span>';
    repairClusters(root);
    expect([...root.children].map((c) => c.textContent)).toEqual(['কা', '', 'র']);
  });
  it('joins a conjunct split after its virama', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span>ক্</span><span>ষ</span>';
    repairClusters(root);
    expect(root.textContent).toBe('ক্ষ');
    expect(root.children[0]!.textContent).toBe('ক্ষ');
  });
});
