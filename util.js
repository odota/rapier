module.exports = {
    extractBuffer: function(bb) {
        return bb;
        //rewrap it in a new Buffer to force usage of node Buffer wrapper rather than ArrayBuffer when in browser
        //return new Buffer(bb.toBuffer());
    }
}