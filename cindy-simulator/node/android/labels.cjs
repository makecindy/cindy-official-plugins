'use strict';
// Portable numeric labels for coordinates and capture timestamps.
const digits={0:['111','101','101','101','111'],1:['010','110','010','010','111'],2:['111','001','111','100','111'],3:['111','001','111','001','111'],4:['101','101','111','001','001'],5:['111','100','111','001','111'],6:['111','100','111','101','111'],7:['111','001','010','010','010'],8:['111','101','111','101','111'],9:['111','101','111','001','111'],'-':['000','000','111','000','000'],'+':['000','010','111','010','000'],m:['00000','11111','10101','10101','10101'],s:['111','100','111','001','111']};
function label(image,value,x,y,scale=2){
  for(const c of String(value)){const glyph=digits[c];if(!glyph)continue;const width=glyph[0].length;
    for(let row=-1;row<=5;row++)for(let col=-1;col<=width;col++)for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
      const px=x+col*scale+dx,py=y+row*scale+dy;if(px<0||py<0||px>=image.width||py>=image.height)continue;
      const index=(py*image.width+px)*4,v=glyph[row]?.[col]==='1'?30:245;image.data[index]=image.data[index+1]=image.data[index+2]=v;image.data[index+3]=255;
    }x+=(width+2)*scale;
  }
}
module.exports={label};
