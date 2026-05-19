// Lightweight natural-language parser for the Create Event demo.
//
// Splits a single free-form query string like
//     "team standup tomorrow at 9am"
//     "lunch with Sarah today at 1pm"
//     "doctor appointment on Friday"
// into a rough { title, when } shape so the example can show the
// pattern of "interpret one query yourself" — the package's current
// sweet spot.
//
// NOT production-quality. This is illustrative. A real app would use
// chrono-node, a typed parameter (post #25 + #29), or its own domain
// parser. We deliberately keep dependencies zero so the example
// compiles without npm work.

export type ParsedEventQuery = {
  title: string;
  /** ISO-ish human label of when the event is — null if not detected. */
  when: string | null;
};

const DAY_WORDS = [
  'today',
  'tomorrow',
  'tonight',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
const AT_TIME_RE = /\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i;
const ON_DAY_RE = new RegExp(`\\bon\\s+(${DAY_WORDS.join('|')})\\b`, 'i');
const BARE_DAY_RE = new RegExp(`\\b(${DAY_WORDS.join('|')})\\b`, 'i');

export function parseEventQuery(raw: string): ParsedEventQuery {
  const query = raw.trim();
  if (!query) return { title: '', when: null };

  let remaining = query;
  const whenParts: string[] = [];

  const at = AT_TIME_RE.exec(remaining);
  if (at) {
    whenParts.push(`at ${at[1].toLowerCase()}`);
    remaining = remaining.replace(at[0], '').trim();
  } else {
    const time = TIME_RE.exec(remaining);
    if (time && /\d/.test(time[0]) && (time[3] || time[1].length <= 2)) {
      whenParts.unshift(`at ${time[0].toLowerCase()}`);
      remaining = remaining.replace(time[0], '').trim();
    }
  }

  const onDay = ON_DAY_RE.exec(remaining);
  if (onDay) {
    whenParts.unshift(onDay[1].toLowerCase());
    remaining = remaining.replace(onDay[0], '').trim();
  } else {
    const bareDay = BARE_DAY_RE.exec(remaining);
    if (bareDay) {
      whenParts.unshift(bareDay[1].toLowerCase());
      remaining = remaining.replace(bareDay[0], '').trim();
    }
  }

  // Strip dangling connector words left behind after slicing out the
  // time/day phrases.
  const title = remaining
    .replace(/\b(at|on|for)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    title: title || query,
    when: whenParts.length ? whenParts.join(' ') : null,
  };
}
