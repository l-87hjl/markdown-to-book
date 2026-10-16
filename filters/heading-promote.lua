-- SPDX-License-Identifier: MIT
-- A matching book-title H1 is optional. Preserve actual H1 chapters.
local is_html = FORMAT:match('html') or FORMAT:match('epub')
local is_latex = FORMAT:match('latex') or FORMAT:match('pdf')
local function normalized(value)
  return pandoc.utils.stringify(value):gsub('%s+', ' '):lower():match('^%s*(.-)%s*$')
end
local function shortmark(header)
  local text = header.attributes['short-title'] or pandoc.utils.stringify(header.content)
  if utf8.len(text) > 42 then
    text = text:sub(1, (utf8.offset(text, 40) or (#text + 1)) - 1)
    text = text:match('^(.*)%s') or text
    text = text .. '…'
  end
  return pandoc.write(pandoc.Pandoc({pandoc.Plain({pandoc.Str(text)})}), 'latex'):gsub('%s+$', '')
end
function Pandoc(doc)
  local first
  for _, block in ipairs(doc.blocks) do
    if block.t == 'Header' then first = block; break end
  end
  local remove = first and first.level == 1 and doc.meta.title
    and normalized(first.content) == normalized(doc.meta.title)
    and not doc.meta['keep-title-heading']
  local removed = false
  return doc:walk({Header = function(el)
    if remove and not removed and el.level == 1 then removed = true; return {} end
    if remove and el.level > 1 then el.level = el.level - 1 end
    if is_html and el.level == 2 then
      return pandoc.Div({pandoc.Para({pandoc.Strong(el.content)})}, pandoc.Attr(el.identifier, {'section-heading'}))
    end
    if is_latex and el.level == 1 then
      return {el, pandoc.RawBlock('latex', '\\markboth{' .. shortmark(el) .. '}{}')}
    end
    return el
  end})
end
