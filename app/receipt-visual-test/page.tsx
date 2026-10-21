import {notFound} from "next/navigation";
import ReceiptModalVisualTest from "@/components/receipt-modal-visual-test";
export default function ReceiptModalTestPage(){
 if(process.env.NODE_ENV!=="development")notFound();
 return <ReceiptModalVisualTest/>;
}
