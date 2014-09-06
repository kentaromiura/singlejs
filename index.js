var jsdom = require('jsdom');
var fs = require('fs')
var $
var path = require('path')
var btoa = require('btoa')
var clint = require('clint')()

clint.command('--help', '-h', 'General usage information')
clint.command('--file', '-f', 'Use the html file as a entry point')
var options = {
  help: false,
  file: null
}
clint.on('command', function(name, value){
  switch(name){
    case '--help': options.help = true; break
    case '--file': options.file = value; break
  }
})


function traverse (node, callback){
  callback(node);
  if(node.nodeName == 'TEMPLATE') return;
  var children = $(node.children)
  if(children) children.forEach(function(child){
    traverse(child, callback)
  })
}

var ast = {
  stylesheets: [],
  scripts: []
};

function stylesheet(node, relativePath){
  if(node.nodeName == 'LINK'){
    var rel = node.getAttribute('rel')
    if(rel && rel.toLowerCase() == 'stylesheet'){
      node.handled = true
      //for now just push to stylesheets the raw href, we'll fix relative and cache later
      ast.stylesheets.push(path.normalize(relativePath + node.getAttribute('href')))
    }
  }
}

function script(node, relativePath){
  if(node.nodeName == 'SCRIPT'){
    // let's assume all the script are js
    //for now just push to scripts
    node.handled = true
    ast.scripts.push(path.normalize(relativePath + node.getAttribute('src')))
  }
}
function nop(){}

function htmlimport(node, relativePath, onDone){

  if(node.nodeName == 'LINK'){
    var rel = node.getAttribute('rel')
    if(rel.toLowerCase() == 'import'){
      node.handled = true
      var file = relativePath + node.getAttribute('href')
      parseHTML(fs.readFileSync(file), path.dirname(file) +'/', onDone)
    } else {
      (onDone || nop)()
    }
  } else {
    (onDone || nop)()
  }
}

function skippable(node){
  switch(node.nodeName){
    case 'HTML':
    case 'BODY':
    case 'HEAD':
    case 'META':
      node.handled = true
    break
  }
}

function makeInlineScript(html){
  var wrap = [
      '(function(){var temp = document.createElement("div");',
      'temp.innerHTML = atob("',btoa(html), '");',
      'document.head.appendChild(temp.firstChild)})();'
    ]
  return wrap.join('')
}

function template(node){
  if(node.nodeName == 'TEMPLATE'){
    ast.scripts.push( makeInlineScript(node.outerHTML) );
    node.handled = true
  }
}

var waiting = []
function parseHTML(html, relativePath, after){
  jsdom.env({
    html: html,
    done: function(e, window){
        global.window = window;
        global.document = window.document;

        window.nodeType = 'window' // since global != window, domready fails
        if(!$) $ = require('elements')
        var waiting = [], ready = false;

        traverse(document.documentElement, function(each){
          template(each)
          stylesheet(each, relativePath)
          script(each, relativePath)
          waiting.push(each)
          htmlimport(each, relativePath, function(){
            waiting.splice(waiting.indexOf(each), 1)
            //I Should replace this with flow...
            if(ready && waiting.length == 0 && after) after()
          })
          skippable(each)
          if(!each.handled) console.log('not handled: ', each.nodeName, each.outerHTML)
        })
        ready = true

        if(waiting.length == 0 && after) after()
    }
});
}

clint.on('complete', function(){
  if (options.help || !options.file){
    console.log(clint.help(2, " : "))
    console.log('Use -f index.html')
    process.exit(0)
  }

var relativePath = path.dirname(options.file) + '/'
//var relativePath = '../brick/dist/';
try {
  var html = fs.readFileSync(options.file)
  //var html = fs.readFileSync(relativePath + 'brick.html')
} catch (e){
  console.log("Error while opening ", options.file);
  process.exit(1)
}
  start(html, relativePath);

});
clint.parse(process.argv.slice(2))

function start(html, relativePath){
  parseHTML(html, relativePath, function(){
  function dedup(array){
    return array.filter(function(entry, i) {
      return array.indexOf(entry) == i;
    })
  }
  function inlineCSS(array){
    return array.map(function(entry){
      return '<style>' + fs.readFileSync(entry) + '</style>'
    })
  }
  function inlineScript(array){
    return array.map(function(entry){
      if(entry.indexOf('(function') == 0) return entry
      return fs.readFileSync(entry) + ';'
    })
  }
  ast = {
    stylesheets : inlineCSS(dedup(ast.stylesheets)),
    scripts : inlineScript(dedup(ast.scripts))
  }
  var output = []
  for(var i = 0, max = ast.stylesheets.length; i < max; i++){
    output.push(makeInlineScript(ast.stylesheets[i]))
  }

  for(var s = 0, smax = ast.scripts.length; s < smax; s++){
    output.push(ast.scripts[s])
  }
  console.log(output.join('').replace(/;\s*;/g, ';'))
})

}
