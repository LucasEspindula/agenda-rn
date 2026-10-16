"use client";
import {useState} from "react";
import "./portal-submissions.css";
export default function PortalSubmissions(){
 const [message]=useState("Controle de guias preparado; aguardando ativação e homologação.");
 return <section className="portal-submissions" aria-label="Guias de convênio"><h2>Guias e apresentação no portal</h2><p>{message}</p></section>;
}
