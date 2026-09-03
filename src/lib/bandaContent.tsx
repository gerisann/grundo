import type { ReactNode } from 'react';
import type { BandaPost } from '@/lib/api';

/** A banda-posztok/chat-üzenetek emberi ideje a termékspec szerint. */
export function formatBandaTimestamp(createdAt: number | null, now = Date.now()): string {
  if (createdAt === null) return 'most';
  const elapsed = Math.max(0, now - createdAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'most';
  if (minutes < 60) return `${minutes} perce`;

  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${hours} órája`;

  const days = Math.floor(elapsed / 86_400_000);
  if (days < 7) return `${days} napja`;

  const date = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Korlátozott, biztonságos formázott szöveg. Nincs `dangerouslySetInnerHTML`:
 * csak az editor által előállított jelöléseket alakítjuk React-elemmé.
 */
export function BandaPostContent({ text, format }: Pick<BandaPost, 'text' | 'format'>) {
  if (format === 'plain') return <span className="banda-post__plain">{text}</span>;

  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    if (/^-\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index] ?? '')) {
        items.push(<li key={index}>{renderInline((lines[index] ?? '').replace(/^-\s+/, ''))}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index] ?? '')) {
        items.push(<li key={index}>{renderInline((lines[index] ?? '').replace(/^\d+\.\s+/, ''))}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quotes: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quotes.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quotes.map((part, i) => <span key={i}>{renderInline(part)}{i < quotes.length - 1 ? <br /> : null}</span>)}</blockquote>);
      continue;
    }

    blocks.push(line ? <p key={index}>{renderInline(line)}</p> : <br key={index} />);
    index += 1;
  }
  return <div className="banda-post__rich">{blocks}</div>;
}

const INLINE = /(\*\*[^*\n]+\*\*|_[^_\n]+_|\+\+[^+\n]+\+\+|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('++') && part.endsWith('++')) return <u key={index}>{part.slice(2, -2)}</u>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return part;
  });
}
