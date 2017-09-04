import { DangerDSLType } from "../node_modules/danger/distribution/dsl/DangerDSL"
declare var danger: DangerDSLType
declare function message(message: string): void
declare function warn(message: string): void
declare function fail(message: string): void
declare function markdown(message: string): void
declare function markdown(message: string): void

import mdspell from "markdown-spellcheck"
import getFileContents from "./get-file-contents"
import context from "./string-index-context"

export interface SpellCheckWord {
  word: string
  index: number
}

interface SpellCheckContext {
  info: string
  lineNumber: number
}

const leftSquareBracket = "&#91;"

export const spellCheck = (file: string, sourceText: string, ignoredWords: string[], ignoredRegexs: string[]) =>
  new Promise(res => {
    const errors = mdSpellCheck(sourceText)

    const presentableErrors = errors
      .filter(e => ignoredWords.indexOf(e.word.toLowerCase()) === -1)
      .filter(e => !ignoredRegexs.find(r => !!e.word.match(new RegExp(r.substring(1)))))

    const contextualErrors = presentableErrors.map(e =>
      context.getBlock(sourceText, e.index, e.word.length)
    ) as SpellCheckContext[]

    if (contextualErrors.length > 0) {
      markdown(`
### Typos for ${danger.github.utils.fileLinks([file])}

| Line | Typo |
| ---- | ---- |
${contextualErrors.map(contextualErrorToMarkdown).join("\n")}
        `)
    }

    res()
  })

const contextualErrorToMarkdown = (error: SpellCheckContext) => {
  const sanitizedMarkdown = error.info.replace(/\[/, leftSquareBracket)
  return `${error.lineNumber} | ${sanitizedMarkdown}`
}

const getPRParams = path => ({ ...danger.github.thisPR, path, ref: danger.github.pr.head.ref })

export const mdSpellCheck = (sourceText: string): SpellCheckWord[] =>
  mdspell.spell(sourceText, { ignoreNumbers: true, ignoreAcronyms: true })

export const githubRepresentationforPath = (value: string) => {
  if (value.includes("@")) {
    return {
      path: value.split("@")[1] as string,
      owner: value.split("@")[0].split("/")[0] as string,
      repo: value.split("@")[0].split("/")[1] as string,
    }
  }
}

export const parseSettingsFromFile = async (path: string, repo: any): Promise<SpellCheckSettings> => {
  const data = await getFileContents(path, repo)
  if (data) {
    const settings = JSON.parse(data) as SpellCheckJSONSettings
    return {
      ignore: (settings.ignore || []).map(w => w.toLowerCase()),
      whitelistFiles: settings.whitelistFiles || [],
    }
  } else {
    return { ignore: [], whitelistFiles: [] }
  }
}

export const getSpellcheckSettings = async (options?: SpellCheckOptions): Promise<SpellCheckSettings> => {
  let ignoredWords = [] as string[]
  let whitelistedMarkdowns = [] as string[]

  if (options && options.settings) {
    const settingsRepo = githubRepresentationforPath(options.settings)
    if (settingsRepo) {
      const globalSettings = await parseSettingsFromFile(settingsRepo.path, settingsRepo)
      ignoredWords = ignoredWords.concat(globalSettings.ignore)
      whitelistedMarkdowns = whitelistedMarkdowns.concat(globalSettings.whitelistFiles)
    }
  }

  const localSettings = await parseSettingsFromFile("spellcheck.json", getPRParams("spellcheck.json"))
  ignoredWords = ignoredWords.concat(localSettings.ignore)
  whitelistedMarkdowns = whitelistedMarkdowns.concat(localSettings.whitelistFiles)

  return { ignore: ignoredWords, whitelistFiles: whitelistedMarkdowns }
}

/**
 * Optional ...options.
 *
 * Today it offers:
 *
 *  - `settings` a peril-like-GH-path to the JSON file of ignored words. e.g.
 *    "orta/words@ignore_words.json" which is the repo orta/words and the file
 *    "ignore_words.json". See the README for usage.
 *
 */
export interface SpellCheckOptions {
  settings: string
}

/**
 * A de-null'd version of the spell settings
 */
export interface SpellCheckSettings {
  ignore: string[]
  whitelistFiles: string[]
}

/**
 * This is the _expected_ structure of the JSON file for settings.
 */
export type SpellCheckJSONSettings = Partial<SpellCheckSettings>

/**
 * Spell checks any created or modified markdown files.
 *
 * Has an optional setting object for things like ignore.
 */
export default async function spellcheck(options?: SpellCheckOptions) {
  const allChangedFiles = [...danger.git.modified_files, ...danger.git.created_files]
  const allMD = allChangedFiles.filter(f => f.endsWith(".md") || f.endsWith(".markdown"))

  const settings = await getSpellcheckSettings(options)
  const ignore = settings.ignore || []
  const whitelistFiles = settings.whitelistFiles || []

  const ignoredRegexes = ignore.filter(f => f.startsWith("/"))
  const ignoredWords = ignore.filter(f => !f.startsWith("/"))

  const markdowns = allMD.filter(md => whitelistFiles.indexOf(md) === -1)

  for (const file of markdowns) {
    const contents = await getFileContents(file, getPRParams(file))
    if (contents) {
      await spellCheck(file, contents, ignoredWords, ignoredRegexes)
    }
  }
}
