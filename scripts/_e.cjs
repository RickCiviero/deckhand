const fs=require('fs');let s=fs.readFileSync('e2e/editing.spec.ts','utf8').replace(/\r\n/g,'\n');
const a='  expect(c.text()).toMatch(/<img src="images\/Other\.png" alt="A pixel" style=/);\n});\n';
if(!s.includes(a))throw new Error('miss');
s=s.replace(a,'  expect(c.text()).toMatch(/<img src="images\/Other\.png" alt="A pixel" style=/);\n  await c.page.getByTestId(\'cmd-crop\').click();\n  await save(c.page);\n  expect(c.text()).toMatch(/<img src="images\/Other\.png" alt="A pixel" style="[^"]*object-fit: cover/);\n});\n');
s+=`
test('Insert > Icons adds an inline SVG that takes the text colour; one Undo removes it', async () => {
  c = await launch('ai-fixed-stage.html');
  await ready(c.page);
  await c.page.getByTestId('tab-insert').click();
  await c.page.getByTestId('cmd-icons').click();
  await c.page.getByTestId('icon-star').click();
  await expect(c.page.getByTestId('savestate')).toHaveText('Unsaved changes');
  await save(c.page);
  expect(c.text()).toMatch(/<svg viewBox="0 0 24 24" role="img" aria-label="Star" style="position: absolute; left: \d+px; top: \d+px; width: 96px; height: 96px; color: #4472c4;" fill="none" stroke="currentColor"/);
  await c.page.getByTestId('qat-undo').click();
  await save(c.page).catch(() => undefined);
  expect(c.read().equals(original('ai-fixed-stage.html'))).toBe(true);
});
`;
fs.writeFileSync('e2e/editing.spec.ts',s);
