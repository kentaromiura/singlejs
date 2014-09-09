Single JS
=========

A simple tool to build multiple components as a single js file.

How to use it
=============
Example how to build brick (assuming brick is in ../brick):

`./singlejs -f ../brick/dist/brick.html > output.js`

to get a minified js:
`./singlejs -m -f ../brick/dist/brick.html > output.js`

to get the maximum compression available (it removes spaces inside templates):
`./singlejs -a -f ../brick/dist/brick.html > output.js`
