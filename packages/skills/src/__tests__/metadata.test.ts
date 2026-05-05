import { describe, expect, it } from 'vitest';
import { skills, skillsByName } from '../index.js';

describe('skill metadata registry', () => {
  it('all registered skills expose metadata for harness routing', () => {
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.metadata.description.length).toBeGreaterThan(0);
      expect(skill.metadata.when_to_use.length).toBeGreaterThan(0);
      expect(skill.metadata.examples.length).toBeGreaterThan(0);
    }
  });

  it('skillsByName contains the registered skills', () => {
    for (const skill of skills) {
      expect(skillsByName[skill.name]).toBe(skill);
    }
  });
});
