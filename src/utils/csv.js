// simple CSV export helper
export function downloadCSV(filename, rows, headers){
  if(!rows || !rows.length){ alert("No data to export"); return }

  // if headers not passed, use keys from first row
  const cols = headers && headers.length ? headers : Object.keys(rows[0])
  const csv = [
    cols.join(','),  // header row
    ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
