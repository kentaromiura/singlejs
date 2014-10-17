var jsdom = require('jsdom'),
  fs = require('fs'),
  $,
  path = require('path'),
  clint = require('clint')(),
  escodegen = require('escodegen'),
  esprima = require('esprima'),
  esmangle = require('esmangle'),
  CleanCSS = require('clean-css'),
  ast = {
    stylesheets: [],
    scripts: []
  },
  options = {
    help: false,
    mangle: false,
    aggressive: false,
    file: null,
    useScriptTemplate: false
  },
  waiting = []

clint.command('--help', '-h', 'General usage information')
clint.command('--file', '-f', 'Use the html file as a entry point')
clint.command('--mangle', '-m', 'Mangle the output')
clint.command('--aggressive', '-a',
  'Remove whitespaces inside template (-a includes -m)')
clint.command('--experimental-script-template', '-xst',
  'Use script type text/template instead of the template element')

clint.on('command', function(name, value) {
  switch (name) {
    case '--help':
      options.help = true
      break
    case '--file':
      options.file = value
      break
    case '--mangle':
      options.mangle = true
      break
    case '--aggressive':
      options.aggressive = true
      options.mangle = true
      break
    case '--experimental-script-template':
      options.useScriptTemplate = true;
      break
  }
})

function traverse(node, callback) {
  callback(node)
  if (node.nodeName == 'TEMPLATE') return
  var children = $(node.children)
  if (children) children.forEach(function(child) {
    traverse(child, callback)
  })
}

function stylesheet(node, relativePath) {
  if (node.nodeName == 'STYLE') {
    ast.stylesheets.push({
      type: 'inline',
      value: node.innerHTML
    })
    node.handled = true
  }
  if (node.nodeName == 'LINK') {
    var rel = node.getAttribute('rel')
    if (rel && rel.toLowerCase() == 'stylesheet') {
      node.handled = true
        //for now just push to stylesheets the raw href, we'll fix relative and cache later
      ast.stylesheets.push(path.normalize(relativePath + node.getAttribute(
        'href')))
    }
  }
}

function script(node, relativePath) {
  if (node.nodeName == 'SCRIPT') {
    // let's assume all the script are js
    //for now just push to scripts
    node.handled = true
    ast.scripts.push(path.normalize(relativePath + node.getAttribute('src')))
  }
}

function nop() {}

function htmlimport(node, relativePath, onDone) {
  onDone = onDone || nop
  if (node.nodeName == 'LINK') {
    var rel = node.getAttribute('rel')
    if (rel.toLowerCase() == 'import') {
      node.handled = true
      var file = relativePath + node.getAttribute('href')
      parseHTML(fs.readFileSync(file), path.dirname(file) + '/', onDone)
    } else {
      onDone()
    }
  } else {
    onDone()
  }
}

function skippable(node) {
  switch (node.nodeName) {
    case 'HTML':
    case 'BODY':
    case 'HEAD':
    case 'META':
      node.handled = true
      break
  }
}

function makeInlineScript(html) {
  var escapedhtml = escodegen.generate({
    type: "ExpressionStatement",
    expression: {
      type: "Literal",
      value: html
    }
  })

  var wrap = [
    '!function(){var temp = document.createElement("div");',
    'temp.innerHTML = ', escapedhtml,
    'document.head.appendChild(temp.firstChild)}();'
  ]
  return wrap.join('')
}

function template(node) {
  if (node.nodeName == 'TEMPLATE') {
    if (options.mangle) {
      // templates need a manual minimization.
      var styles = $('style', node)
      if (styles) styles.forEach(function(style) {
        style.innerHTML = new CleanCSS()
          .minify(style.innerHTML)
      })
    }

    if (options.aggressive) {
      //this remove newlines and whitespaces, it can cause layout differencies.
      //http://stackoverflow.com/a/13370852/27340
      var removeWhiteSpaceNodes = function(parent) {
        var nodes = parent.childNodes
        for (var i = 0, l = nodes.length; i < l; i++) {
          if (nodes[i] && nodes[i].nodeType == 3 && !/\S/.test(nodes[i].nodeValue)) {
            parent.replaceChild(document.createTextNode(''), nodes[i])
          } else if (nodes[i]) {
            removeWhiteSpaceNodes(nodes[i])
          }
        }
      }
      removeWhiteSpaceNodes(node)
    }
    if (options.useScriptTemplate) {
      var templateHTML = ['<SCRIPT type="text/template" '];
      if (node.attributes)[].forEach.call(node.attributes, function(attribute) {
        templateHTML.push(attribute.name, '="', attribute.value, '" ');
      })
      templateHTML.push('>', node.innerHTML, '</SCRIPT>')
      ast.scripts.push(makeInlineScript(templateHTML.join('')))
    } else {
      ast.scripts.push(makeInlineScript(node.outerHTML))
    }
    node.handled = true
  }
}

function parseHTML(html, relativePath, after) {
  jsdom.env({
    html: html,
    done: function(e, window) {
      global.window = window
      global.document = window.document

      window.nodeType = 'window' // since global != window, domready fails
      if (!$) $ = require('elements')
      var waiting = [],
        ready = false

      traverse(document.documentElement, function(each) {
        template(each)
        stylesheet(each, relativePath)
        script(each, relativePath)
        waiting.push(each)
        htmlimport(each, relativePath, function() {
          waiting.splice(waiting.indexOf(each), 1)
            //I Should replace this with flow...
          if (ready && waiting.length == 0 && after) after()
        })
        skippable(each)
        if (!each.handled) console.log('not handled: ', each.nodeName,
          each.outerHTML)
      })
      ready = true

      if (waiting.length == 0 && after) after()
    }
  })
}

clint.on('complete', function() {
  if (options.help || !options.file) {
    console.log(clint.help(2, " : "))
    console.log('Use -f index.html')
    process.exit(0)
  }

  var relativePath = path.dirname(options.file) + '/'

  try {
    var html = fs.readFileSync(options.file)
  } catch (e) {
    console.log("Error while opening ", options.file)
    process.exit(1)
  }
  start(html, relativePath)
})

function start(html, relativePath) {
  parseHTML(html, relativePath, function() {
    var output = []

    function dedup(array) {
      return array.filter(function(entry, i) {
        return array.indexOf(entry) == i
      })
    }

    function inlineCSS(array) {
      return array.map(function(entry) {

        var css = entry.type === 'inline' ? entry.value : fs.readFileSync(
          entry)
        if (options.mangle) css = new CleanCSS()
          .minify(css)
        return '<style>' + css + '</style>'
      })
    }

    function inlineScript(array) {
      return array.map(function(entry) {
        var script = entry
        if (entry.indexOf('!function') != 0) script = fs.readFileSync(
          entry) + ';'
        if (!options.mangle) return script
        return escodegen.generate(esmangle.mangle(esprima.parse(
          script)), {
          format: {
            renumber: true,
            hexadecimal: true,
            escapeless: true,
            compact: true,
            semicolons: false,
            parentheses: false
          }
        }) + ';'
      })
    }
    ast = {
      stylesheets: inlineCSS(dedup(ast.stylesheets)),
      scripts: inlineScript(dedup(ast.scripts))
    }

    for (var i = 0, max = ast.stylesheets.length; i < max; i++) {
      output.push(makeInlineScript(ast.stylesheets[i]))
    }

    for (var s = 0, smax = ast.scripts.length; s < smax; s++) {
      output.push(ast.scripts[s])
    }
    console.log(output.join('')
      .replace(/;\s*;+/g, ';'))
  })
}

clint.parse(process.argv.slice(2))
