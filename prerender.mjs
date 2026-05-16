import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(rootDir, 'dist')
const serverDir = path.join(distDir, 'server')
const templatePath = path.join(distDir, 'index.html')
const serverEntryPath = path.join(serverDir, 'entry-server.js')

const template = await readFile(templatePath, 'utf8')
const { render } = await import(pathToFileURL(serverEntryPath).href)
const appHtml = render()

const rootMarker = '<div id="root"></div>'
if (!template.includes(rootMarker)) {
  throw new Error(`Could not find ${rootMarker} in dist/index.html`)
}

await writeFile(
  templatePath,
  template.replace(rootMarker, `<div id="root">${appHtml}</div>`),
)
await rm(serverDir, { recursive: true, force: true })
