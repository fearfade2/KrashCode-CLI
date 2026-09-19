import React from 'react';
import { Box, Text } from 'ink';

// Лёгкий рендер Markdown в Ink-компоненты. Поддерживает заголовки, списки,
// блоки кода, цитаты, горизонтальные линии и инлайн (жирный/курсив/код/ссылки).

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

// Разбор инлайновой разметки в цепочку сегментов.
export function parseInline(text: string): Segment[] {
  const segments: Segment[] = [];
  let i = 0;
  let plain = '';
  const flush = () => {
    if (plain) segments.push({ text: plain });
    plain = '';
  };

  while (i < text.length) {
    const rest = text.slice(i);

    // Инлайн-код `...`
    const codeMatch = /^`([^`]+)`/.exec(rest);
    if (codeMatch) {
      flush();
      segments.push({ text: codeMatch[1]!, code: true });
      i += codeMatch[0].length;
      continue;
    }

    // Жирный **...** или __...__
    const boldMatch = /^(\*\*|__)(.+?)\1/.exec(rest);
    if (boldMatch) {
      flush();
      for (const seg of parseInline(boldMatch[2]!)) segments.push({ ...seg, bold: true });
      i += boldMatch[0].length;
      continue;
    }

    // Курсив *...* или _..._
    const italicMatch = /^(\*|_)(?!\s)(.+?)(?<!\s)\1/.exec(rest);
    if (italicMatch) {
      flush();
      for (const seg of parseInline(italicMatch[2]!)) segments.push({ ...seg, italic: true });
      i += italicMatch[0].length;
      continue;
    }

    // Ссылка [text](url) → показываем текст, url в скобках приглушённо
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (linkMatch) {
      flush();
      segments.push({ text: linkMatch[1]!, italic: true });
      segments.push({ text: ` (${linkMatch[2]})` });
      i += linkMatch[0].length;
      continue;
    }

    plain += text[i];
    i += 1;
  }
  flush();
  return segments;
}

function Inline({ text }: { text: string }): React.ReactElement {
  const segments = parseInline(text);
  return (
    <Text wrap="wrap">
      {segments.map((seg, idx) => (
        <Text
          key={idx}
          bold={seg.bold}
          italic={seg.italic}
          color={seg.code ? 'yellow' : undefined}
          backgroundColor={seg.code ? 'gray' : undefined}
        >
          {seg.text}
        </Text>
      ))}
    </Text>
  );
}

type Block =
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'li'; ordered: boolean; marker: string; text: string; indent: number }
  | { kind: 'hr' }
  | { kind: 'p'; text: string }
  | { kind: 'blank' };

// Разбор текста на блоки.
export function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Блок кода ```lang
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1]!.trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // закрывающий забор
      blocks.push({ kind: 'code', lang, lines: body });
      continue;
    }

    if (line.trim() === '') {
      blocks.push({ kind: 'blank' });
      i += 1;
      continue;
    }

    // Горизонтальная линия
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // Заголовок
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      i += 1;
      continue;
    }

    // Цитата
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({ kind: 'quote', text: quote[1]! });
      i += 1;
      continue;
    }

    // Список: маркированный или нумерованный
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const indent = li[1]!.length;
      const raw = li[2]!;
      const ordered = /\d/.test(raw);
      blocks.push({
        kind: 'li',
        ordered,
        marker: ordered ? raw.replace(/[.)]/, '.') : '•',
        text: li[3]!,
        indent,
      });
      i += 1;
      continue;
    }

    blocks.push({ kind: 'p', text: line });
    i += 1;
  }
  return blocks;
}

const HEADING_COLORS = ['magenta', 'cyan', 'green', 'yellow', 'blue', 'blue'];

export function Markdown({ children }: { children: string }): React.ReactElement {
  const blocks = parseBlocks(children ?? '');
  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case 'blank':
            return <Text key={idx}> </Text>;
          case 'hr':
            return <Text key={idx} dimColor>{'─'.repeat(40)}</Text>;
          case 'heading': {
            const color = HEADING_COLORS[block.level - 1] ?? 'white';
            return (
              <Text key={idx} bold color={color}>
                {block.text}
              </Text>
            );
          }
          case 'quote':
            return (
              <Box key={idx} marginLeft={0}>
                <Text dimColor>│ </Text>
                <Inline text={block.text} />
              </Box>
            );
          case 'li':
            return (
              <Box key={idx} marginLeft={1 + block.indent}>
                <Text color="cyan">{block.marker} </Text>
                <Inline text={block.text} />
              </Box>
            );
          case 'code':
            return (
              <Box key={idx} flexDirection="column" marginY={0} paddingLeft={1} borderStyle="round" borderColor="gray" borderDimColor>
                {block.lines.length === 0 ? (
                  <Text> </Text>
                ) : (
                  block.lines.map((l, j) => (
                    <Text key={j} color="green">{l || ' '}</Text>
                  ))
                )}
              </Box>
            );
          case 'p':
          default:
            return <Inline key={idx} text={block.text} />;
        }
      })}
    </Box>
  );
}
