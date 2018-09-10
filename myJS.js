
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

function rannum() {
	document.getElementById("xoso").innerHTML =
Math.floor(Math.random() * 1000000);
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

function getSum(total, num) {
    return total + num;
}
function myFunction(item) {
    document.getElementById("tongkg").innerHTML = lua.reduce(getSum);
}