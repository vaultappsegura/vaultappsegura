const Jimp = require("jimp");
async function main() {
    console.log("Reading...");
    const image = await Jimp.read('public/logo.png');
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    const size = Math.max(width, height);
    console.log("Original size:", width, "x", height, "New size:", size, "x", size);
    
    // Create new image with transparent background
    const padded = new Jimp(size, size, 0x00000000);
    
    // Calculate offsets to center the original image
    const xOffset = Math.floor((size - width) / 2);
    const yOffset = Math.floor((size - height) / 2);
    
    padded.composite(image, xOffset, yOffset);
    await padded.writeAsync('public/logo_square.png');
    console.log("Done");
}
main().catch(console.error);
