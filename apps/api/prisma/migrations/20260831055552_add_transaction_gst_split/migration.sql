-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "basePaise" INTEGER,
ADD COLUMN     "cgstPaise" INTEGER,
ADD COLUMN     "gstPaise" INTEGER,
ADD COLUMN     "igstPaise" INTEGER,
ADD COLUMN     "placeOfSupplyStateCode" TEXT,
ADD COLUMN     "sgstPaise" INTEGER;
