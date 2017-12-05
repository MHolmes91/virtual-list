var path = require('path');
var webpack = require('webpack');

module.exports = {
 entry: {
   'vlist': './vlist.js',
   'vlist.min': './vlist.js',
 },

 output: {
   path: path.resolve(__dirname, 'dist'),
   filename: "[name].js",
   libraryTarget: "var",
   library: "VirtualList"
 },

 plugins: [
   new webpack.optimize.UglifyJsPlugin({
      include: /\.min\.js$/,
      minimize: true,
      sourceMap: true
   })
 ]
};