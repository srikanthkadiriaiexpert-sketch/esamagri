import { describe, expect, it } from 'vitest';
import {
  csvField,
  timestampForFilename,
  toCsv,
  toCsvFromColumns,
  type CsvColumn,
} from './csv';

describe('csvField — plain values', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('Kumar')).toBe('Kumar');
    expect(csvField('IV-2026-000123')).toBe('IV-2026-000123');
  });

  it('writes null and undefined as an empty field, never as the word null', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('writes numbers and booleans without quoting them', () => {
    expect(csvField(0)).toBe('0');
    expect(csvField(12.5)).toBe('12.5');
    expect(csvField(false)).toBe('false');
  });
});

describe('csvField — escaping', () => {
  it('quotes a value containing a comma', () => {
    expect(csvField('Kumar, A.')).toBe('"Kumar, A."');
  });

  it('doubles internal quotes and wraps the field', () => {
    expect(csvField('Quarter "B" Block')).toBe('"Quarter ""B"" Block"');
  });

  it('quotes a value containing a newline, so one record stays one row', () => {
    expect(csvField('Line one\nLine two')).toBe('"Line one\nLine two"');
  });

  it('quotes a value containing a carriage return', () => {
    expect(csvField('A\r\nB')).toBe('"A\r\nB"');
  });

  it('quotes a value with leading or trailing space, which a reader would eat', () => {
    expect(csvField('  padded  ')).toBe('"  padded  "');
    expect(csvField('trailing ')).toBe('"trailing "');
  });

  it('handles a value that is only a quote', () => {
    expect(csvField('"')).toBe('""""');
  });

  it('handles an empty string without quoting it', () => {
    expect(csvField('')).toBe('');
  });
});

describe('csvField — formula neutralisation', () => {
  it('neutralises a leading = so a spreadsheet does not execute it', () => {
    expect(csvField('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"'
    );
  });

  it('neutralises the other formula leads', () => {
    expect(csvField('+1234')).toBe("'+1234");
    expect(csvField('-1+2')).toBe("'-1+2");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('neutralises a leading tab, and quotes it because a tab is edge whitespace', () => {
    expect(csvField('\t=1+1')).toBe('"\'\t=1+1"');
  });

  it('does not touch a value whose formula character is not first', () => {
    expect(csvField('A=B')).toBe('A=B');
    expect(csvField('Flat 2-B')).toBe('Flat 2-B');
  });

  it('can be switched off for a machine-read file', () => {
    expect(csvField('=1+1', { neutraliseFormulas: false })).toBe('=1+1');
  });

  it('still neutralises a negative number, which is the cost of the rule', () => {
    // Documented deliberately: a leading '-' is indistinguishable from a
    // formula lead, so a genuinely negative figure gains an apostrophe. No
    // column in the fulfilment export is negative, and the alternative is
    // letting '-2+3*cmd' through.
    expect(csvField(-5)).toBe("'-5");
  });
});

describe('toCsv', () => {
  it('joins with CRLF, as RFC 4180 and Excel expect', () => {
    const csv = toCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
    expect(csv).toBe('a,b\r\n1,2\r\n3,4');
  });

  it('emits the header row even when there are no records', () => {
    expect(toCsv(['Voucher', 'RIK ID'], [])).toBe('Voucher,RIK ID');
  });

  it('escapes header cells too', () => {
    expect(toCsv(['Quantity, issued'], [])).toBe('"Quantity, issued"');
  });

  it('adds no BOM — that belongs to the file, not the string', () => {
    expect(toCsv(['a'], [])).not.toContain('﻿');
  });

  it('keeps empty cells as empty fields so columns stay aligned', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, '', undefined]])).toBe('a,b,c\r\n,,');
  });
});

describe('toCsvFromColumns', () => {
  interface Row {
    name: string;
    qty: number | null;
  }
  const columns: CsvColumn<Row>[] = [
    { header: 'Name', value: (r) => r.name },
    { header: 'Quantity', value: (r) => r.qty },
  ];

  it('writes the headers and the values from one declaration', () => {
    const csv = toCsvFromColumns(columns, [
      { name: 'Rice', qty: 5 },
      { name: 'Dal, split', qty: null },
    ]);
    expect(csv).toBe('Name,Quantity\r\nRice,5\r\n"Dal, split",');
  });

  it('produces just the header line for an empty record set', () => {
    expect(toCsvFromColumns(columns, [])).toBe('Name,Quantity');
  });
});

describe('timestampForFilename', () => {
  it('is sortable and filename-safe', () => {
    const stamp = timestampForFilename(new Date(2026, 10, 10, 8, 1));
    expect(stamp).toBe('2026-11-10-0801');
    expect(stamp).not.toMatch(/[:/\\ ]/);
  });

  it('pads single digits', () => {
    expect(timestampForFilename(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02-0304');
  });
});
