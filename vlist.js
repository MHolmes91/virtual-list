/**
 * The MIT License (MIT)
 *
 * Original Work Copyright (C) 2013 Sergi Mansilla
 * Modified Work Copyright (C) 2017 Mark Holmes
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

var throttle =  require('./node_modules/lodash.throttle');

/**
 * Creates a virtually-rendered scrollable list.
 * @param {object} config
 * @param {int} config.w - Container Width (optional)
 * @param {int} config.h - Container Height
 * @param {int} config.itemHeight - Height of each individual item in pixels
 * @param {String[]|Element[]|Object[]} config.items - An array of items to be used in this list (Can be strings, DOM elements, or an object to be transformed using generatorFN) (optional)
 * @param {Function} config.generatorFn - {(int) => {Element}} Function Input is the index of the item being generated, output is a DOMElement to be inserted into the list (optional)
 * @param {int} config.totalRows - The total number of items (if different from the length of the items array) (optional)
 * @param {int} config.itemBuffer - The number of items to have loaded at a time, this should be larger than the height of the container / height of each item (optional)
 * @constructor
 */
function VirtualList(config) {
  var width = (config && config.w) ? (config.w + 'px') : '100%';
  var height = (config && config.h) ? (config.h + 'px') : '100%';
  var itemHeight = this.itemHeight = config.itemHeight;

  this.items = config.items ? config.items : [];

  /*
  Will be an object containing all nodes currently in the container in the form {status: 0/1, node: DOMNode}
  Status 0 means the node is hidden and pending deletion, 1 means it is being displayed
  */
  this.itemsInContainer = {};

  if (config.generatorFn) {
    this.generatorFn = config.generatorFn;
  }
  this.totalRows = config.totalRows || this.items.length;

  var scroller = VirtualList.createScroller(itemHeight * this.totalRows);
  this.container = VirtualList.createContainer(width, height);
  this.container.appendChild(scroller);

  var screenItemsLen = Math.ceil(config.h / itemHeight);
  // Cache 4 times the number of items that fit in the container viewport or a custom number
  this.cachedItemsLen = config.itemBuffer ? config.itemBuffer : screenItemsLen * 3;
  this._renderChunk(this.container, 0);

  var _this = this;
  var lastRepaintY;
  var maxBuffer = screenItemsLen * itemHeight;
  var lastScrolled = 0;

  // As soon as scrolling has stopped, this function will asynchronously remove all
  // the nodes that are not used anymore
  this.throttledRmNode = throttle(function() {
    if (Date.now() - lastScrolled > 100) {
      //Only items that are visible (status = 1) should be in the container
      _this.itemsInContainer = Object.keys(_this.itemsInContainer).reduce(function(items, index) {
        var item = _this.itemsInContainer[index];
        if (item.status === 1) {
          items[index] = item;
        }

        return items;
      }, {});

      //Scroller is the first item and shouldn't be removed, remove all other children
      while (_this.container.children.length > 1) {
        _this.container.removeChild(_this.container.lastChild);
      }

      //Re-add the items that should be in the container
      Object.keys(_this.itemsInContainer).forEach(function(index) {
        var item = _this.itemsInContainer[index];
        _this.container.appendChild(item.node);
      });
    }
  }, 300, { leading: false, trailing: true });

  function onScroll(e) {
    var scrollTop = e.target.scrollTop; // Triggers reflow
    if (!lastRepaintY || Math.abs(scrollTop - lastRepaintY) > maxBuffer) {
      var first = parseInt(scrollTop / itemHeight) - screenItemsLen;
      _this._renderChunk(_this.container, first < 0 ? 0 : first);
      _this.throttledRmNode();
      lastRepaintY = scrollTop;
    }

    lastScrolled = Date.now();
    e.preventDefault && e.preventDefault();
  }

  this.container.addEventListener('scroll', onScroll);
}

VirtualList.prototype.generatorFn = function(items, i, itemHeight) {
  var item;
  //If we have an array of items and if we have an item at the current index
  if (items && typeof items[i] !== "undefined") {
    //Create the item as a text node if it is a string
    if (typeof items[i] === 'string') {
      item = document.createElement('div');

      var itemText = document.createTextNode(items[i]);
      item.appendChild(itemText);
    }
    //Otherwise, assume the item is a DOM element and use it directly
    else {
      return items[i];
    }
  }
  //If blank, create a blank div
  else {
    item = document.createElement('div');
  }

  item.style.height = itemHeight + 'px';

  return item;
};

VirtualList.prototype.createRow = function(i) {
  var item = this.generatorFn(this.items, i, this.itemHeight);

  item.classList.add('vrow');
  item.style.display = '';
  item.style.position = 'absolute';
  item.style.top = (i * this.itemHeight) + 'px';

  return item;
};

/**
 * Renders a particular, consecutive chunk of the total rows in the list. To
 * keep acceleration while scrolling, we mark the nodes that are candidate for
 * deletion instead of deleting them right away, which would suddenly stop the
 * acceleration. We delete them once scrolling has finished.
 *
 * @param {Node} node Parent node where we want to append the children chunk.
 * @param {Number} from Starting position, i.e. first children index.
 * @return {void}
 */
VirtualList.prototype._renderChunk = function(node, from) {
  var _this = this;
  var finalItem = from + this.cachedItemsLen;
  if (finalItem > this.totalRows) {
    finalItem = this.totalRows;
  }

  // Hide and mark obsolete nodes for deletion.
  Object.keys(this.itemsInContainer).forEach(function(key) {
    var itemInContainer = _this.itemsInContainer[key];
    itemInContainer.status = 0;
    itemInContainer.node.style.display = 'none';
  });

  // Append all the new rows in a document fragment that we will later append to
  // the parent node
  var fragment = document.createDocumentFragment();
  for (var i = from; i < finalItem; i++) {
    var row = this.createRow(i);
    this.itemsInContainer[i] = { status: 1, node: row };
    fragment.appendChild(row);
  }

  node.appendChild(fragment);
};

VirtualList.createContainer = function(w, h) {
  var c = document.createElement('div');
  c.style.width = w;
  c.style.height = h;
  c.style.overflow = 'auto';
  c.style.position = 'relative';
  c.style.padding = 0;
  c.classList.add('vContainer');
  return c;
};

VirtualList.createScroller = function(h) {
  var scroller = document.createElement('div');
  scroller.style.opacity = 0;
  scroller.style.position = 'absolute';
  scroller.style.top = 0;
  scroller.style.left = 0;
  scroller.style.width = '1px';
  scroller.style.height = h + 'px';
  scroller.classList.add('vScroller');
  return scroller;
};

module.exports = VirtualList;