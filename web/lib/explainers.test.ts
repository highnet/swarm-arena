/**
 * The explainer routes (#233): a skill's chapters get stable anchors for the page's section nav.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstHeading, sectionChapters } from './source';

test('each h2 chapter is wrapped in a section with a unique, labelled anchor', () => {
  const { html, sections } = sectionChapters(
    '<p>Intro.</p><h2>Ideas worth trying</h2><p>a</p><h2>What failed &amp; why</h2><p>b</p>' +
      '<h2>Ideas worth trying</h2><p>c</p><h2>Overview</h2><p>d</p>',
  );
  assert.deepEqual(sections, [
    { id: 'ideas-worth-trying', title: 'Ideas worth trying' },
    { id: 'what-failed-why', title: 'What failed & why' },
    { id: 'ideas-worth-trying-2', title: 'Ideas worth trying' },
    // `overview` is the page's own first chapter, so the skill's gets another anchor.
    { id: 'overview-2', title: 'Overview' },
  ]);
  assert.ok(html.startsWith('<p>Intro.</p><section id="ideas-worth-trying"'));
  assert.match(
    html,
    /<h2 id="what-failed-why-title">What failed &amp; why<\/h2><p>b<\/p><\/section>/,
  );
  assert.equal(html.match(/<section /g)?.length, 4);
  assert.equal(html.match(/<\/section>/g)?.length, 4);
});

test('markdown with no h2 is left as it is', () => {
  assert.deepEqual(sectionChapters('<p>Just text.</p>'), {
    html: '<p>Just text.</p>',
    sections: [],
  });
});

test("a skill's title is its first heading outside fenced code", () => {
  assert.equal(firstHeading('```sh\n# not a title\n```\n\nIntro.\n'), null);
  const h = firstHeading('```sh\n# comment\n```\n# Real title\nBody.\n');
  assert.equal(h?.title, 'Real title');
  assert.equal(h?.rest, '```sh\n# comment\n```\n\nBody.\n');
});
