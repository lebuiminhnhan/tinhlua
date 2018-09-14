
//hàm popup đổi tên
function pop() {
	var txt;
    var person = prompt("Mời bạn nhập tên:", "Groot Le");
    if (person == null || person == "") {
        txt = "Đừng để trống tên chứ!";
    } else {
        txt = "Xin chào ! " + person + " !";

    }
    document.getElementById("hello").innerHTML = txt;
}
// tạo marnng lưu số kg lúa
var lua = [];
document.getElementById("arr").innerHTML = lua;
function addarr() {
	var x= Number(document.getElementById('them').value);
    lua.push(x);
    
	document.getElementById("arr").innerHTML =lua;
	document.getElementById("dem").innerHTML = lua.length;
}   
function rearr() {
    lua.pop();
    document.getElementById("dem").innerHTML = lua.length;
    document.getElementById("arr").innerHTML = lua;
}
// tính tổng kg lúa
function getSum(total, num) {
    return total + num;
}
// tính
function myFunction(item) {
    var a,b;
    document.getElementById("tongkg").innerHTML = lua.reduce(getSum).toFixed(2);
    a= Number(document.getElementById("tongkg").innerHTML = lua.reduce(getSum));
    b=Number (document.getElementById("sotien").value);
    if (isNaN(a)  || a < -9999999999 || a > 9999999999 || a == " ") {
        text1 = "Chỉ nhập số";
    } else {
        text1 = " OK";
    }
    if (isNaN(b)  || b < -9999999999 || b > 9999999999 || b == " ") {
        text2 = "Chỉ nhập số";
    } else {
        text2 = "OK";
    }

    var kqn= (a * b).toFixed(0);
    var sgc= (a/20).toFixed(2);
    if(sgc>30)
    {
        if(kqn>3500000)
        {
            text3 = "Trúng mùa, được giá";
            document.getElementById("kq").innerHTML=text3;
        }
        else
        {
            text4="Lúa mất giá";
            document.getElementById("kq").innerHTML=text4;
        }
    }
    else
    {
        text5="Lúa thất";
        document.getElementById("kq").innerHTML=text5;
    }
    
    document.getElementById('doctien').innerHTML=DOCSO.doc(kqn) + " đồng.";
    document.getElementById('kqn').innerHTML=kqn;
    document.getElementById("kt1").innerHTML = text1;
    document.getElementById("kt2").innerHTML = text2;
    document.getElementById("tien").innerHTML=b;
    document.getElementById("gc").innerHTML=sgc;
    document.getElementById("veso").innerHTML =
Math.floor(Math.random() * 1000000);
}
function reverseNumber(td) {
    return [].map.call(td, function(x) {
       return x;
     }).reverse().join(''); 
   }
 function splitInDots(td) {
     var value = td.value,
         plain = plainNumber(value),
         reversed = reverseNumber(plain),
         reversedWithDots = reversed.match(/.{1,3}/g).join('.'),
         normal = reverseNumber(reversedWithDots);
     
     console.log(plain,reversed, reversedWithDots, normal);
     td.value = normal;
   }
 function plainNumber(number) {
     return number.split('.').join('');
 }

 var DOCSO=function(){var t=["không","một","hai","ba","bốn","năm","sáu","bảy","tám","chín"],r=function(r,n){var o="",a=Math.floor(r/10),e=r%10;return a>1?(o=" "+t[a]+" mươi",1==e&&(o+=" mốt")):1==a?(o=" mười",1==e&&(o+=" một")):n&&e>0&&(o=" lẻ"),5==e&&a>=1?o+=" lăm":4==e&&a>=1?o+=" tư":(e>1||1==e&&0==a)&&(o+=" "+t[e]),o},n=function(n,o){var a="",e=Math.floor(n/100),n=n%100;return o||e>0?(a=" "+t[e]+" trăm",a+=r(n,!0)):a=r(n,!1),a},o=function(t,r){var o="",a=Math.floor(t/1e6),t=t%1e6;a>0&&(o=n(a,r)+" triệu",r=!0);var e=Math.floor(t/1e3),t=t%1e3;return e>0&&(o+=n(e,r)+" ngàn",r=!0),t>0&&(o+=n(t,r)),o};return{doc:function(r){if(0==r)return t[0];var n="",a="";do ty=r%1e9,r=Math.floor(r/1e9),n=r>0?o(ty,!0)+a+n:o(ty,!1)+a+n,a=" tỷ";while(r>0);return n.trim()}}}();
