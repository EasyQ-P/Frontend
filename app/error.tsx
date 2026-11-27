"use client"; // 오류 화면은 클라이언트 컴포넌트여야 한다

// 화면을 그리다 예상하지 못한 오류가 났을 때. 다시 시도하면 그 화면만 다시 그린다
import { useEffect } from "react";
import { Sticker } from "@/components/Brand";
import { Button, Screen } from "@/components/ui";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // 오류 수집 서비스를 붙이면 여기서 보낸다
    console.error(error);
  }, [error]);

  return (
    <Screen width="narrow">
      <div className="flex flex-1 flex-col items-center px-8 pt-24 text-center">
        <Sticker size={96} rotate={8} float>
          😵
        </Sticker>
        <h1 className="mt-8 text-[32px] font-extrabold leading-tight tracking-[-0.05em]">문제가 생겼어요</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          화면을 보여주는 중에 오류가 났어요.
          <br />
          다시 시도해도 안 되면 처음 화면으로 돌아가 주세요.
        </p>
        <div className="mt-auto w-full space-y-3 pb-10 pt-10">
          <Button size="lg" icon="undo" className="w-full" onClick={() => retry()}>
            다시 시도
          </Button>
          <Button href="/" size="lg" variant="white" className="w-full">
            처음 화면으로
          </Button>
        </div>
      </div>
    </Screen>
  );
}
