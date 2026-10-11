'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
/** Desktop scroll region, narrow-screen divided list with explicit field labels. */
export function TableScroll({children}:{children:ReactNode}) {
 const ref=useRef<HTMLDivElement>(null);
 const [overflow,setOverflow]=useState(false);
 useEffect(()=>{
  const el=ref.current!;
  const update=()=>{
   const headers=Array.from(el.querySelectorAll('thead th')).map(h=>h.textContent?.trim()||'Actions');
   el.querySelectorAll('tbody tr').forEach(row=>Array.from(row.children).forEach((cell,i)=>cell.setAttribute('data-label',headers[i]??'')));
   setOverflow(el.scrollWidth>el.clientWidth+1);
  };
  update();const resize=new ResizeObserver(update);resize.observe(el);
  const mutation=new MutationObserver(update);mutation.observe(el,{childList:true,subtree:true,characterData:true});
  return ()=>{resize.disconnect();mutation.disconnect();};
 },[]);
 return <div className="table-container">{overflow&&<p className="table-scroll-hint">Scroll horizontally to see all columns ↔</p>}<div ref={ref} className="table-scroll" tabIndex={overflow?0:undefined} role={overflow?'region':undefined} aria-label={overflow?'Scrollable data table':undefined}>{children}</div></div>;
}
