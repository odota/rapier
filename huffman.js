var Heap = require('heap');
/**
 * Given an array of counts, builds a huffman tree
 **/
function buildTree(counts) {
    //input as an array of weights
    //then value=index, weight=array[index]
    //construct the tree by using a priority queue (heap)
    var heap = new Heap(function(a, b) {
        return a.weight - b.weight;
    });
    //push all the elements into the heap with custom comparator
    //pop them out in sorted order
    counts.forEach(function(w, i) {
        w = w || 1;
        heap.push(HuffmanNode({
            weight: w,
            value: i
        }));
    });
    var n = counts.length;
    while (heap.size() > 1) {
        //to build the tree:
        //pop two elements out
        //construct a new node with value=sum of the two, left/right children, then push the new node into the 
        //repeat until heap only has one element left
        var a = heap.pop();
        var b = heap.pop();
        heap.push(HuffmanNode({
            weight: a.weight + b.weight,
            value: n,
            left: a,
            right: b
        }));
        n += 1;
    }
    //this element is the root of the tree, return it
    return heap.pop();
}

function HuffmanNode(options) {
    var self = {};
    self.weight = options.w;
    self.value = options.v;
    self.left = options.left;
    self.right = options.right;
    self.isLeaf = function(){
        return !self.left && !self.right;
    };
    return self;
}

module.exports = buildTree;