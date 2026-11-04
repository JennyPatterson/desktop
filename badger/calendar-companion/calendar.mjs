export function meetingFeed(items, now, timeZone) {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return items
    .filter(item => item.status !== 'cancelled'
      && item.transparency !== 'transparent'
      && !item.attendees?.some(person => person.self && person.responseStatus === 'declined')
      && item.start?.dateTime && item.end?.dateTime)
    .map(item => {
      const start = Date.parse(item.start.dateTime);
      const end = Date.parse(item.end.dateTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error('Google Calendar returned invalid meeting times');
      }
      return {
        name: (item.summary || 'Untitled meeting').replace(/\s+/g, ' ').slice(0, 200),
        start: Math.floor(start / 1000),
        end: Math.floor(end / 1000),
        start_label: clock.format(start),
        end_label: clock.format(end),
        start_day: day.format(start),
      };
    })
    .filter(item => item.end > now)
    .sort((a, b) => a.start - b.start);
}
