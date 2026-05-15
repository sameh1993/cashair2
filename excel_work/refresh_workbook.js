const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "unzipped", "xl");
const themePath = path.join(root, "theme", "theme1.xml");
const stylesPath = path.join(root, "styles.xml");
const drawingPath = path.join(root, "drawings", "drawing1.xml");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, "utf8");
}

function replaceAll(content, replacements) {
  let next = content;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  return next;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeTwoCellAnchorByName(content, shapeName) {
  const pattern = new RegExp(
    `<xdr:twoCellAnchor\\b[^>]*>[\\s\\S]*?<xdr:cNvPr[^>]*name="${escapeRegExp(
      shapeName
    )}"[^>]*\\/>[\\s\\S]*?<\\/xdr:twoCellAnchor>`,
    "g"
  );
  return content.replace(pattern, "");
}

function refreshTheme() {
  const theme = read(themePath);
  const updated = replaceAll(theme, [
    ['<a:lt2><a:srgbClr val="EEECE1"/></a:lt2>', '<a:lt2><a:srgbClr val="F5F7FB"/></a:lt2>'],
    ['<a:accent1><a:srgbClr val="4F81BD"/></a:accent1>', '<a:accent1><a:srgbClr val="2563EB"/></a:accent1>'],
    ['<a:accent2><a:srgbClr val="C0504D"/></a:accent2>', '<a:accent2><a:srgbClr val="0F172A"/></a:accent2>'],
    ['<a:accent3><a:srgbClr val="9BBB59"/></a:accent3>', '<a:accent3><a:srgbClr val="0F766E"/></a:accent3>'],
    ['<a:accent4><a:srgbClr val="8064A2"/></a:accent4>', '<a:accent4><a:srgbClr val="14B8A6"/></a:accent4>'],
    ['<a:accent5><a:srgbClr val="4BACC6"/></a:accent5>', '<a:accent5><a:srgbClr val="38BDF8"/></a:accent5>'],
    ['<a:accent6><a:srgbClr val="F79646"/></a:accent6>', '<a:accent6><a:srgbClr val="F59E0B"/></a:accent6>'],
    ['<a:hlink><a:srgbClr val="0000FF"/></a:hlink>', '<a:hlink><a:srgbClr val="1D4ED8"/></a:hlink>'],
    ['<a:folHlink><a:srgbClr val="800080"/></a:folHlink>', '<a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>'],
    ['<a:font script="Arab" typeface="Times New Roman"/>', '<a:font script="Arab" typeface="Tajawal"/>'],
    ['<a:font script="Hebr" typeface="Times New Roman"/>', '<a:font script="Hebr" typeface="Tajawal"/>'],
    ['<a:font script="Arab" typeface="Arial"/>', '<a:font script="Arab" typeface="Tajawal"/>'],
    ['<a:font script="Hebr" typeface="Arial"/>', '<a:font script="Hebr" typeface="Tajawal"/>']
  ]);

  write(themePath, updated);
}

function refreshStyles() {
  const styles = read(stylesPath);
  const updated = replaceAll(styles, [
    ['FF92D050', 'FF0F766E'],
    ['FF0000FF', 'FF1D4ED8'],
    [
      '<font><i/><sz val="48"/><color theme="6" tint="-0.499984740745262"/><name val="Myriad Pro Black"/><family val="2"/></font>',
      '<font><b/><sz val="30"/><color theme="4"/><name val="Tajawal"/><family val="2"/></font>'
    ]
  ]);

  write(stylesPath, updated);
}

function refreshDrawing() {
  let drawing = read(drawingPath);

  for (const shapeName of [
    "Group 35",
    "صورة 138",
    "صورة 139",
    "صورة 140",
    "صورة 141",
    "صورة 142",
    "شكل بيضاوي 143"
  ]) {
    drawing = removeTwoCellAnchorByName(drawing, shapeName);
  }

  drawing = replaceAll(drawing, [
    ['val="00B050"', 'val="0F766E"'],
    ['val="0000FF"', 'val="1D4ED8"'],
    ['<a:t>برنامج مدير المخزن والمبيعات</a:t>', '<a:t>نظام إدارة المخزون والمبيعات</a:t>']
  ]);

  write(drawingPath, drawing);
}

refreshTheme();
refreshStyles();
refreshDrawing();
console.log("Workbook visuals refreshed.");
