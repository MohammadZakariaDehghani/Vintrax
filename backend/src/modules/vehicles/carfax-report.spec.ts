import {
  htmlToLines,
  parseCarfaxReport,
  parseReportDate,
  MAX_CARFAX_RECORDS,
} from './carfax-report';

/**
 * Reading a CARFAX report page.
 *
 * ── What these tests can and cannot prove ───────────────────────────────────
 *
 * They cannot prove the parser reads a real report, because a real report
 * needs a real link and this parser has never been pointed at one. What they
 * prove is the property that matters more: that it fails to `unreadable`
 * instead of inventing findings, on every shape of page that is not what it
 * expects.
 *
 * That asymmetry is deliberate. A parser that misses a real accident costs the
 * dealer a manual entry. A parser that reports a clean history for a car that
 * has been hit costs a buyer twenty thousand dollars, and Vintrax its
 * credibility. So the fixtures below lean on the second kind of mistake, and
 * every "cannot read this" result is an intended outcome rather than a gap.
 */

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

describe('parseReportDate', () => {
  it('reads the unambiguous formats a report prints', () => {
    expect(parseReportDate('2019-03-14')).toBe('2019-03-14');
    expect(parseReportDate('March 14, 2019')).toBe('2019-03-14');
    expect(parseReportDate('Mar. 14 2019')).toBe('2019-03-14');
    expect(parseReportDate('14 March 2019')).toBe('2019-03-14');
    expect(parseReportDate('Reported on 3 Apr 2021 by an insurer')).toBe('2021-04-03');
  });

  it('refuses a numeric date whose order cannot be established', () => {
    // 03/04/2019 is 3 March in Canada and 4 March elsewhere, and the page
    // looks the same either way. A wrong accident date is worse than none.
    expect(parseReportDate('03/04/2019')).toBeNull();
    expect(parseReportDate('01.02.2020')).toBeNull();
  });

  it('reads a numeric date when only one order is possible', () => {
    expect(parseReportDate('14/03/2019')).toBe('2019-03-14');
    expect(parseReportDate('03/14/2019')).toBe('2019-03-14');
  });

  it('rejects a date that does not exist', () => {
    expect(parseReportDate('2019-02-31')).toBeNull();
    expect(parseReportDate('February 30, 2019')).toBeNull();
  });

  it('finds nothing in text with no date', () => {
    expect(parseReportDate('Damage reported, $4,200')).toBeNull();
    expect(parseReportDate('')).toBeNull();
  });
});

describe('htmlToLines', () => {
  it('keeps one block per line', () => {
    expect(htmlToLines('<tr><td>2019-03-14</td></tr><tr><td>$4,200</td></tr>')).toEqual([
      '2019-03-14',
      '$4,200',
    ]);
  });

  it('drops scripts, so the page code is not read as findings', () => {
    // A report page carries its own JavaScript, and the word "accident" inside
    // it is a variable name, not something about this car.
    const lines = htmlToLines('<script>var accidentCount = 3;</script><p>Hello</p>');

    expect(lines.join(' ')).not.toContain('accidentCount');
    expect(lines).toContain('Hello');
  });

  it('decodes the entities a report actually uses', () => {
    expect(htmlToLines('<p>Front&nbsp;&amp;&nbsp;rear</p>')).toEqual(['Front & rear']);
  });
});

describe('parseCarfaxReport', () => {
  it('reads dated records out of the accident section', () => {
    const report = parseCarfaxReport(
      page(`
        <h2>Accident / Damage Record</h2>
        <tr><td>2019-03-14</td><td>Damage reported</td><td>$4,200</td></tr>
        <tr><td>2021-07-02</td><td>Accident reported</td><td>$11,860</td></tr>
        <h2>Liens</h2>
        <p>2022-01-01 No liens found</p>
      `),
    );

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;

    expect(report.records).toHaveLength(2);
    expect(report.records[0]?.occurredOn).toBe('2019-03-14');
    expect(report.records[1]?.occurredOn).toBe('2021-07-02');
    expect(report.statedAccidentFree).toBe(false);
  });

  it('stops at the next section, so a lien is not read as a crash', () => {
    const report = parseCarfaxReport(
      page(`
        <h2>Accident / Damage Record</h2>
        <tr><td>2019-03-14 Damage reported $4,200</td></tr>
        <h2>Lien Search</h2>
        <tr><td>2020-05-05 Lien registered $9,000</td></tr>
      `),
    );

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.occurredOn).toBe('2019-03-14');
  });

  it('reports a clean result only when the page states one', () => {
    const report = parseCarfaxReport(
      page('<h2>Accident / Damage Record</h2><p>No accidents reported to CARFAX.</p>'),
    );

    expect(report).toEqual({ status: 'ok', records: [], statedAccidentFree: true });
  });

  it('refuses to call an unrecognised page clean', () => {
    // The whole point. "I found no records" and "I could not find the section"
    // look identical to a caller and mean opposite things to a buyer.
    const report = parseCarfaxReport(page('<h2>Vehicle Details</h2><p>2019 Toyota RAV4</p>'));

    expect(report.status).toBe('unreadable');
  });

  it('refuses when the section is found but says nothing it understands', () => {
    // A redesign that keeps the heading and changes everything under it lands
    // here, which is the case this exists for.
    const report = parseCarfaxReport(
      page('<h2>Accident / Damage Record</h2><div><span>See the full report</span></div>'),
    );

    expect(report.status).toBe('unreadable');
  });

  it('refuses an empty page rather than calling it clean', () => {
    expect(parseCarfaxReport('').status).toBe('unreadable');
    expect(parseCarfaxReport('<html></html>').status).toBe('unreadable');
  });

  it('is not fooled by the word "damage" elsewhere on the page', () => {
    const report = parseCarfaxReport(
      page(`
        <h2>Service Records</h2>
        <tr><td>2019-03-14 Bumper damage repaired $400</td></tr>
        <h2>Odometer</h2>
      `),
    );

    // No accident section at all, so nothing is claimed either way.
    expect(report.status).toBe('unreadable');
  });

  it('keeps a record that has an estimate but no usable date', () => {
    // A report listing damage without a date it can parse has still reported
    // damage. Dropping it would hide a finding.
    const report = parseCarfaxReport(
      page('<h2>Accident / Damage Record</h2><p>Damage reported — estimate $3,100</p>'),
    );

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.occurredOn).toBeNull();
  });

  it('does not turn prose into a record', () => {
    // Lines with neither a date nor an amount are disclaimers, and this is how
    // a parser invents an accident out of one.
    const report = parseCarfaxReport(
      page(`
        <h2>Accident / Damage Record</h2>
        <p>CARFAX receives information from many sources and cannot guarantee it is complete.</p>
      `),
    );

    expect(report.status).toBe('unreadable');
  });

  it('caps how many records one report contributes', () => {
    const rows = Array.from(
      { length: 40 },
      (_, index) =>
        `<tr><td>2019-03-${String((index % 28) + 1).padStart(2, '0')} Damage $${index}00</td></tr>`,
    ).join('');
    const report = parseCarfaxReport(page(`<h2>Accident / Damage Record</h2>${rows}`));

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.records.length).toBeLessThanOrEqual(MAX_CARFAX_RECORDS);
  });

  it('joins a record split across lines', () => {
    const report = parseCarfaxReport(
      page(`
        <h2>Accident / Damage Record</h2>
        <div>March 14, 2019</div>
        <div>Accident reported</div>
        <div>Estimated damage $4,200</div>
      `),
    );

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.occurredOn).toBe('2019-03-14');
    expect(`${report.records[0]?.label} ${report.records[0]?.detail}`).toContain('4,200');
  });
});

/**
 * Reading the report's own data rather than its rendered text.
 *
 * The first real report failed with "no accident or damage section was found"
 * having fetched cleanly, which is what a page drawn by JavaScript looks like
 * from a server: no heading in the HTML because no report is in the HTML, only
 * a container and a blob of JSON. These cover that path.
 *
 * The same rule governs it as governs the text reader: finding no data is not
 * a finding. It falls through rather than reporting a clean history.
 */
describe('parseCarfaxReport, from embedded data', () => {
  const shell = (json: string, id = '__NEXT_DATA__') =>
    `<!doctype html><html><head><title>CARFAX Canada Vehicle History Report</title></head>
     <body><div id="root"></div>
     <script id="${id}" type="application/json">${json}</script>
     <script src="/bundle.js"></script></body></html>`;

  it('reads records out of a JSON blob when the page has no rendered text', () => {
    const report = parseCarfaxReport(
      shell(
        JSON.stringify({
          props: {
            report: {
              accidents: [
                { date: '2019-03-14', description: 'Damage reported', estimate: '4,200' },
                { date: '2021-07-02', description: 'Accident reported', estimate: '$11,860' },
              ],
            },
          },
        }),
      ),
    );

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.records).toHaveLength(2);
    expect(report.records[0]?.occurredOn).toBe('2019-03-14');
    expect(report.records[0]?.detail).toContain('4,200');
    expect(report.records[1]?.label).toBe('Accident reported');
  });

  it('reads an explicit accident-free flag', () => {
    const report = parseCarfaxReport(
      shell(JSON.stringify({ report: { accidentFree: true, accidents: [] } })),
    );

    expect(report).toEqual({ status: 'ok', records: [], statedAccidentFree: true });
  });

  it('reads "hasAccidents: false" as the same statement', () => {
    const report = parseCarfaxReport(shell(JSON.stringify({ vehicle: { hasAccidents: false } })));

    expect(report).toEqual({ status: 'ok', records: [], statedAccidentFree: true });
  });

  it('does not call an empty accident array clean on its own', () => {
    // An empty list with nothing saying why is not a statement that the car is
    // clean — it is as likely to be a list that failed to load.
    const report = parseCarfaxReport(shell(JSON.stringify({ report: { accidents: [] } })));

    expect(report.status).toBe('unreadable');
  });

  it('is not fooled by a flag that merely mentions accidents', () => {
    // The page's own JavaScript talks about accidents. A feature flag is not a
    // finding, which is why the keys are a fixed list rather than a search.
    const report = parseCarfaxReport(
      shell(
        JSON.stringify({ config: { showAccidentBanner: true, accidentTabLabel: 'Accidents' } }),
      ),
    );

    expect(report.status).toBe('unreadable');
  });

  it('ignores an array entry with neither a date nor a description', () => {
    const report = parseCarfaxReport(
      shell(JSON.stringify({ accidents: [{ id: 7, vehicleId: 'abc' }] })),
    );

    expect(report.status).toBe('unreadable');
  });

  it('survives malformed JSON without throwing', () => {
    expect(parseCarfaxReport(shell('{not json at all')).status).toBe('unreadable');
  });

  it('reads a blob assigned to a window global', () => {
    const html = `<html><body><div id="app"></div><script>
      window.__REPORT_DATA__ = {"accidents":[{"date":"2020-05-05","description":"Damage reported"}]};
    </script></body></html>`;

    const report = parseCarfaxReport(html);

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.records[0]?.occurredOn).toBe('2020-05-05');
  });

  it('prefers the data over the text when a page carries both', () => {
    // A server-rendered page that also embeds its data. The data is the
    // structured version of the same thing, so it wins.
    const html = `<html><body>
      <script type="application/json">{"accidents":[{"date":"2019-03-14","description":"From data"}]}</script>
      <h2>Accident / Damage Record</h2><p>2021-01-01 From text $500</p>
    </body></html>`;

    const report = parseCarfaxReport(html);

    expect(report.status).toBe('ok');
    if (report.status !== 'ok') return;
    expect(report.records).toHaveLength(1);
    expect(report.records[0]?.label).toBe('From data');
  });
});

describe('the failure diagnosis', () => {
  it('says the page is browser-rendered when it is', () => {
    const report = parseCarfaxReport(
      `<html><head><title>CARFAX Report</title></head><body><div id="root"></div>
       <script>${'x'.repeat(4000)}</script></body></html>`,
    );

    expect(report.status).toBe('unreadable');
    if (report.status !== 'unreadable') return;
    expect(report.reason).toContain('drawn in the browser');
    expect(report.diagnosis).toContain('looks browser-rendered');
  });

  it('describes a page that is simply not a report', () => {
    const report = parseCarfaxReport(
      '<html><head><title>Buy a report</title></head><body><h1>Pricing</h1><p>' +
        'word '.repeat(300) +
        '</p></body></html>',
    );

    expect(report.status).toBe('unreadable');
    if (report.status !== 'unreadable') return;
    expect(report.diagnosis).toContain('Buy a report');
    expect(report.diagnosis).toContain('Pricing');
  });

  it('stays short enough to show and to log', () => {
    const report = parseCarfaxReport(`<html><body><h1>${'A'.repeat(5000)}</h1></body></html>`);

    expect(report.status).toBe('unreadable');
    if (report.status !== 'unreadable') return;
    expect((report.diagnosis ?? '').length).toBeLessThanOrEqual(400);
  });
});
