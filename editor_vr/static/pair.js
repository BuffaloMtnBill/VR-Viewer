document.getElementById('pair-form').addEventListener('submit',async event=>{
  event.preventDefault();const status=document.getElementById('pair-status');
  try{const response=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:document.getElementById('pair-pin').value})});const result=await response.json();if(!response.ok)throw new Error(result.error);location.assign('/');}
  catch(error){status.textContent=error.message;}
});
