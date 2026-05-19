import { parseEventQuery } from '../parseEventQuery';

describe('parseEventQuery', () => {
  it('extracts title + day + time from canonical phrasing', () => {
    expect(parseEventQuery('team standup tomorrow at 9am')).toEqual({
      title: 'team standup',
      when: 'tomorrow at 9am',
    });
  });

  it('handles "today at <time>"', () => {
    expect(parseEventQuery('lunch with Sarah today at 1pm')).toEqual({
      title: 'lunch with Sarah',
      when: 'today at 1pm',
    });
  });

  it('handles "on <weekday>" without a time', () => {
    expect(parseEventQuery('doctor appointment on Friday')).toEqual({
      title: 'doctor appointment',
      when: 'friday',
    });
  });

  it('handles a bare weekday without "on"', () => {
    expect(parseEventQuery('haircut wednesday')).toEqual({
      title: 'haircut',
      when: 'wednesday',
    });
  });

  it('treats input without temporal hints as pure title', () => {
    expect(parseEventQuery('weekly grocery run')).toEqual({
      title: 'weekly grocery run',
      when: null,
    });
  });

  it('returns an empty parse for empty input', () => {
    expect(parseEventQuery('')).toEqual({ title: '', when: null });
    expect(parseEventQuery('   ')).toEqual({ title: '', when: null });
  });

  it('preserves the full string as title when parsing fails to remove anything', () => {
    // "tonight" is a day word — should still slice out cleanly.
    const out = parseEventQuery('movie night tonight');
    expect(out.when).toBe('tonight');
    expect(out.title).toBe('movie night');
  });

  it('handles "at <time>" without a day', () => {
    const out = parseEventQuery('coffee at 3pm');
    expect(out.title).toBe('coffee');
    expect(out.when).toBe('at 3pm');
  });
});
