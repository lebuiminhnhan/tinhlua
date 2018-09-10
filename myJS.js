function sayHelloJS() {
	document.getElementById('hello').innerHTML="Hello everyone!";
}

function showtime() {
	document.getElementById('time').innerHTML=Date();
}
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
function ojinfo() {
	var myinfo = {
    firstName: "Groot",
    lastName : "Le",
    job   : "Intern",
    age      : 21
	};
 var txt1 =	document.getElementById('info1').innerHTML= "My name is " + myinfo.firstName +" "+ myinfo.lastName +". I'am " + myinfo.age+" years old.";
var txt2 =	document.getElementById('info2').innerHTML= "And i'm working "+myinfo.job+" in {BE}!";
var dem1= txt1.length;
var dem2= txt2.length;
var dem= dem1+dem2;
document.getElementById('dem').innerHTML= "Ở trên có tất cả " +dem+ " kí tự.";
}

var phone = ["Iphone", "Samsung", "Sony", "HTC", "Xiaomi"];
document.getElementById("arr").innerHTML =phone;
function addarr() {
	var x= document.getElementById('them').value;
	phone.push(x);
	document.getElementById("arr").innerHTML =phone;
	
}
function exarr() {
	var phone = ["Iphone", "Samsung", "Sony", "HTC", "Xiaomi","Nokia"];
	var text = "";
var i;
for (i = 0; i < phone.length; i++) {
    text += i +". "+ phone[i] + "<br>";
}
document.getElementById("ex").innerHTML = text;
}
function rannum() {
	document.getElementById("xoso").innerHTML =
Math.floor(Math.random() * 1000000);
}
function hours() {
	var lam;
	var d = new Date();
if(d.getHours()<3&&d.getHours()>18)
	lam="Lúc này là buổi tối!"
if(d.getHours()<=11&&d.getHours()>=3)
	lam="Lúc này là buổi sáng!"
if(d.getHours()<14&&d.getHours()>11)
	lam="Lúc này là buổi trưa!"
if(d.getHours()<=18&&d.getHours()>=14)
	lam="Lúc này là buổi chiều!"
document.getElementById("hour").innerHTML = "Đang trong khoảng "+ d.getHours()+ " giờ " +lam;
}
function out() {
	var txt;
    if (confirm("Bạn xem kĩ chú ý chưa!")) {
        txt = "Bạn đã đồng ý!";
    } else {
        txt = "Bạn đã hủy!";
    }
    document.getElementById("time").innerHTML = txt;
}
function pop() {
	var txt;
    var person = prompt("Mời bạn nhập tên:", "Groot Le");
    if (person == null || person == "") {
        txt = "Đừng để trống tên chứ!";
    } else {
        txt = "Hello !" + person + "! Welcome to my JS !";
    }
    document.getElementById("hello").innerHTML = txt;
}
function ss(argument) {
	var a = Number (document.getElementById("so1").value);
	var	b = Number (document.getElementById("so2").value);
	var c = document.getElementById("e").innerHTML=a>b;
	if (c==true) {
		document.getElementById("e1").innerHTML="Số thứ nhất lớn hơn số thứ hai";
	}
	else
	{
		document.getElementById("e1").innerHTML="Số thứ nhất nhỏ hơn số thứ hai";
	
	}
}
////////////////////////// phần Jquery
// hide some text
// click
$(document).ready(function(){
    $("#p1").click(function(){
        $(this).hide(1500, function(){
            alert("The paragraph is now hidden");
        });
    });
});

//dbclick
$("#p2").dblclick(function(){
    $(this).hide(700);
});
// mousedown
$(document).ready(function(){
    $("#p3").mousedown(function(){
        alert("Bạn vừa chọn cùng của text 3");
    });
});
//hide all
$(document).ready(function(){
    $("#all").click(function(){
        $("*").hide(10000);
    });
});
//hide show toggle
$(document).ready(function(){
    $("#button1").click(function(){
        $("#p4").toggle(1000);
    });
});
$(document).ready(function(){
    $("#button3").click(function(){
        $("#banner").toggle(1000);
    });
});
// fade 
$(document).ready(function(){
    $("#button2").click(function(){
        $("#button3").fadeToggle();
        $("#button4").fadeToggle("slow");
        $("#button5").fadeToggle(3000);
    });
});
// amination
$(document).ready(function(){
    $("#div").mouseenter(function(){
        var div = $("#div"); 
        div.animate({left: '100px'}, "slow");
        div.animate({height: '10px', opacity: '0.4'}, "slow");
    	div.animate({width: '20px', opacity: '0.8'}, "slow");
   		div.animate({height: '100px', opacity: '0.4'}, "slow");
   		div.animate({width: '100px', opacity: '0.8'}, "slow");
        div.animate({height: '50px', opacity: '1'}, "slow");
        div.animate({width: '50px', opacity: '0.8'}, "slow");
         div.animate({left: '-10px'}, "slow");
    });
});
// show html
$(document).ready(function(){
    $("#button4").click(function(){
        alert("HTML: " + $("#p1").html());
    });
});
// add CSS
$(document).ready(function(){
    $("#button5").click(function(){
        $("p").addClass("p");
       	$("#div").addClass("div");
    });
});
$(document).ready(function(){
    $("#button6").click(function(){
        $("h2").css("background-color", "yellow");
    });
});
// show dimensions
$(document).ready(function(){
    $("#button7").click(function(){
        var txt = "";
        txt += "Width of page: " + $("#div1").width() + "</br>";
        txt += "Height of page: " + $("#div1").height();
        $("#div1").html(txt);
      
    });
});