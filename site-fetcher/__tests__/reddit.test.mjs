import test from 'node:test';
import assert from 'node:assert/strict';
import { isRedditThreadUrl, toOldRedditUrl } from '../reddit-extract.mjs';

test('detects Reddit thread URLs', () => {
  assert.equal(
    isRedditThreadUrl('https://www.reddit.com/r/SideProject/comments/abc/title/'),
    true,
  );
  assert.equal(isRedditThreadUrl('https://www.reddit.com/r/SideProject/'), false);
  assert.equal(isRedditThreadUrl('https://example.com/r/x/comments/abc/title/'), false);
});

test('converts Reddit thread URL to old Reddit', () => {
  assert.equal(
    toOldRedditUrl('https://www.reddit.com/r/SideProject/comments/abc/title/?utm_source=x#thing'),
    'https://old.reddit.com/r/SideProject/comments/abc/title/?utm_source=x',
  );
});
