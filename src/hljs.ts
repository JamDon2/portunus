// Shared highlight.js instance: core + the language set the previews support,
// registered once at module load. Imported by the file-preview text/code
// renderers and the shared MarkdownView so both highlight from one registry.
import hljs from "highlight.js/lib/core";
import langRust       from "highlight.js/lib/languages/rust";
import langTS         from "highlight.js/lib/languages/typescript";
import langJS         from "highlight.js/lib/languages/javascript";
import langPy         from "highlight.js/lib/languages/python";
import langGo         from "highlight.js/lib/languages/go";
import langBash       from "highlight.js/lib/languages/bash";
import langJson       from "highlight.js/lib/languages/json";
import langIni        from "highlight.js/lib/languages/ini";
import langYaml       from "highlight.js/lib/languages/yaml";
import langMd         from "highlight.js/lib/languages/markdown";
import langCss        from "highlight.js/lib/languages/css";
import langXml        from "highlight.js/lib/languages/xml";
import langC          from "highlight.js/lib/languages/c";
import langCpp        from "highlight.js/lib/languages/cpp";
import langSql        from "highlight.js/lib/languages/sql";
import langPhp        from "highlight.js/lib/languages/php";
import langLua        from "highlight.js/lib/languages/lua";
import langSwift      from "highlight.js/lib/languages/swift";
import langRuby       from "highlight.js/lib/languages/ruby";
import langJava       from "highlight.js/lib/languages/java";
import langKotlin     from "highlight.js/lib/languages/kotlin";
import langDocker     from "highlight.js/lib/languages/dockerfile";
import langMake       from "highlight.js/lib/languages/makefile";
import langScss       from "highlight.js/lib/languages/scss";
import langLess       from "highlight.js/lib/languages/less";
import langPlain      from "highlight.js/lib/languages/plaintext";

const HLJS_LANGS: [string, Parameters<typeof hljs.registerLanguage>[1]][] = [
  ["rust", langRust], ["typescript", langTS], ["javascript", langJS], ["python", langPy],
  ["go", langGo], ["bash", langBash], ["json", langJson], ["ini", langIni], ["yaml", langYaml],
  ["markdown", langMd], ["css", langCss], ["xml", langXml], ["c", langC], ["cpp", langCpp],
  ["sql", langSql], ["php", langPhp], ["lua", langLua], ["swift", langSwift], ["ruby", langRuby],
  ["java", langJava], ["kotlin", langKotlin], ["dockerfile", langDocker], ["makefile", langMake],
  ["scss", langScss], ["less", langLess], ["plaintext", langPlain],
];
for (const [name, def] of HLJS_LANGS) hljs.registerLanguage(name, def);

export default hljs;
