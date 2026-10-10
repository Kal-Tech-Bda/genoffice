import { transferWorkspace } from '../apps/shell/src/main/workspace-portability.ts'
const args = process.argv.slice(2)
const mode = args[0]
const option = (name) => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}
const source = option('--source'),
  destination = option('--destination')
if (!['backup', 'restore'].includes(mode) || !source || !destination) {
  console.error(
    'Usage: npm run workspace:backup -- backup|restore --source "folder" --destination "new folder"',
  )
  process.exitCode = 1
} else {
  try {
    await transferWorkspace(mode, source, destination)
    console.log(`${mode} completed: ${destination}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
