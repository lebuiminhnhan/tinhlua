
function tinh() {
	var a,b,kqc,kqt,kqn,kqch,text1,text2;
 	a = Number (document.getElementById("so1").value);
	b = Number (document.getElementById("so2").value);
	kqc= a + b;
	kqt= a - b;
	kqn= a * b;
	kqch= a / b;
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
    document.getElementById("kt1").innerHTML = text1;
    document.getElementById("kt2").innerHTML = text2;
	document.getElementById('1so').innerHTML=a;
	document.getElementById('2so').innerHTML=b;
	document.getElementById('kqc').innerHTML=kqc;
	document.getElementById('kqt').innerHTML=kqt;
	document.getElementById('kqn').innerHTML=kqn;
	document.getElementById('kqch').innerHTML=kqch;
}


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
function getSum(total, num) {
    return total + num;
}
function myFunction(item) {
    var a,b;
    document.getElementById("tongkg").innerHTML = lua.reduce(getSum);
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

    var kqn= a * b;
    var sgc= a/20;
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

 